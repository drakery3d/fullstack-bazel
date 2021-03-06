// TODO clean up this file (split up)

import 'reflect-metadata'

import * as bodyParser from 'body-parser'
import * as cookie from 'cookie'
import * as cookieParser from 'cookie-parser'
import * as cors from 'cors'
import * as express from 'express'
import * as http from 'http'
import {Container} from 'inversify'
import {Socket} from 'net'
import * as queryString from 'query-string'
import * as webpush from 'web-push'
import * as WebSocket from 'ws'

import {Config} from '@libs/config'
import {
  AuthMessagesIn,
  ConsumerGroups,
  CookieNames,
  DiscussionsMessagesIn,
  DiscussionsMessagesOut,
  Environment,
  TokenExpiration,
  Topics,
} from '@libs/enums'
import {Message, SocketMessage, User} from '@libs/schema'
import {AuthToken, Id} from '@libs/types'

import {EventDispatcher} from './event-dispatcher'
import {EventListener} from './event-listener'
import {GoogleAdapter} from './google.adapter'
import {MessagesRepository} from './messages.repository'
import {PushSubscriptionRepository} from './push-subscription.repository'
import {UserRepository} from './user.repository'

const container = new Container()
container.bind(Config).toSelf().inSingletonScope()
container.bind(GoogleAdapter).toSelf().inSingletonScope()
container.bind(UserRepository).toSelf().inSingletonScope()
container.bind(MessagesRepository).toSelf().inSingletonScope()
container.bind(EventDispatcher).toSelf().inSingletonScope()
container.bind(EventListener).toSelf().inSingletonScope()
container.bind(PushSubscriptionRepository).toSelf().inSingletonScope()

const app = express()
const server = http.createServer(app)
const wss = new WebSocket.Server({noServer: true})
const googleAdapter = container.get(GoogleAdapter)
const config = container.get(Config)
const userRepo = container.get(UserRepository)
const messageRepo = container.get(MessagesRepository)
const isProd = config.get('ENVIRONMENT') === Environment.Production
const eventDispatcher = container.get(EventDispatcher)
const eventListener = container.get(EventListener)
const pushSubRepo = container.get(PushSubscriptionRepository)
const vapidPublicKey = config.get('WEB_PUSH_VAPID_PUBLIC_KEY')

enum GoogleApi {
  EmailScope = 'https://www.googleapis.com/auth/userinfo.email',
  ProfileScope = 'https://www.googleapis.com/auth/userinfo.profile',
  SignIn = 'https://accounts.google.com/o/oauth2/v2/auth',
}
const params = queryString.stringify({
  client_id: config.get('GOOGLE_SIGN_IN_CLIENT_ID'),
  redirect_uri: config.get('CLIENT_URL'),
  scope: [GoogleApi.EmailScope, GoogleApi.ProfileScope].join(' '),
  response_type: 'code',
  access_type: 'offline',
  prompt: 'consent',
})
const googleSignInUrl = `${GoogleApi.SignIn}?${params}`

const authTokenSecret = config.get('AUTH_TOKEN_SECRET')
const authTokenCookieOptions: express.CookieOptions = {
  httpOnly: true,
  maxAge: TokenExpiration.Auth * 1000,
  sameSite: isProd ? 'strict' : 'lax',
  secure: isProd ? true : false,
  path: '/',
}

webpush.setVapidDetails(
  'mailto:flo@drakery.com',
  vapidPublicKey,
  config.get('WEB_PUSH_VAPID_PRIVATE_KEY'),
)

const broadcast = (message: SocketMessage) => {
  // TODO does wss.client automatically remove disconnected clients or do we need to handle this?
  wss.clients.forEach(client => {
    client.send(JSON.stringify(message))
  })
}

wss.on(
  'connection',
  async (socket: WebSocket, request: http.IncomingMessage, authToken?: AuthToken) => {
    socket.on('message', async message => {
      try {
        const {name, payload} = JSON.parse(message.toString()) as SocketMessage

        if (name === DiscussionsMessagesIn.SendMessage) {
          if (!authToken) return
          if (!payload) return
          const message = await messageRepo.create(payload as string, authToken.userId)
          await eventDispatcher.dispatch(Topics.Messages, [
            {key: message.id, value: JSON.stringify(message)},
          ])
        }

        if (name === DiscussionsMessagesIn.LoadMessages) {
          const messages = await messageRepo.getAll()
          const userIds = [...new Set(messages.map(m => m.userId))]
          const users = await userRepo.getByIds(userIds)
          const message: SocketMessage = {
            name: DiscussionsMessagesOut.ExistingMessages,
            payload: {messages, users},
          }
          socket.send(JSON.stringify(message))
        }

        if (name === AuthMessagesIn.StorePushSubscription) {
          if (!authToken) return
          await pushSubRepo.create(payload as webpush.PushSubscription, authToken.userId)
        }
      } catch (err) {
        console.log('error while handling message', err)
      }
    })
  },
)

eventListener
  .consume(`${ConsumerGroups.Broadcast}_${Id.generate().toString()}`, Topics.Messages)
  .then(stream => {
    stream.subscribe(async (message: Message) => {
      const user = await userRepo.getById(message.userId)
      if (!user) return
      broadcast({name: DiscussionsMessagesOut.ReceiveMessage, payload: {message, user}})
    })
  })

eventListener.consume(ConsumerGroups.PushNotifications, Topics.Messages).then(stream => {
  stream.subscribe(async (message: Message) => {
    const user = await userRepo.getById(message.userId)
    if (!user) return
    const pushSubs = await pushSubRepo.getAll()
    let sent = 0

    const notificationPayload = {
      notification: {
        title: 'New Message',
        body: `View unread message from ${user.name}`,
        icon: 'assets/icons/icon-72x72.png',
        vibrate: [100, 50, 100],
        data: {
          dateOfArrival: Date.now(),
          primaryKey: 1,
          type: 'new-message',
        },
        actions: [
          {
            action: 'view',
            title: 'View message',
          },
        ],
      },
    }

    await Promise.all(
      pushSubs.map(async sub => {
        if (sub.userId !== message.userId) {
          const webpushSub: webpush.PushSubscription = {
            endpoint: sub.endpoint,
            keys: {auth: sub.authKey, p256dh: sub.p256dhKey},
          }
          await webpush.sendNotification(webpushSub, JSON.stringify(notificationPayload))
          sent++
        }
      }),
    )
    console.log('sent', sent, 'push notifications')
  })
})

server.on('upgrade', async (request: http.IncomingMessage, socket: Socket, head: Buffer) => {
  let authToken: AuthToken | undefined
  try {
    if (request.headers.cookie) {
      const cookies = cookie.parse(request.headers.cookie)
      const authTokenStr = cookies[CookieNames.AuthToken]
      if (authTokenStr) {
        authToken = AuthToken.fromString(authTokenStr, authTokenSecret)
      }
    }
  } catch (err) {
  } finally {
    wss.handleUpgrade(request, socket, head, ws => {
      wss.emit('connection', ws, request, authToken)
    })
  }
})

app.use(
  cors({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    origin: (origin: any, callback: (error: any, allow?: boolean) => void) => {
      if (origin === undefined) return callback(null, true)

      if (origin && config.get('CLIENT_URL')) callback(null, true)
      else callback(new Error('Not allowed by CORS'))
    },
    credentials: true,
  }),
)
app.use(bodyParser.json())
app.use(cookieParser())

app.get('', (req, res) => res.json({message: 'Hello from server'}))
app.get('/sign-in-url', (req, res) => res.json({url: googleSignInUrl}))
app.get('/vapid-key', (req, res) => res.json({key: vapidPublicKey}))

app.get('/messages', async (req, res) => {
  const messages = await messageRepo.getAll()
  const userIds = [...new Set(messages.map(m => m.userId))]
  const users = await userRepo.getByIds(userIds)
  res.json({messages, users})
})

app.post('/signin', async (req, res) => {
  try {
    if (req.body.code) {
      console.log('[singin] get google access token')
      const googleToken = await googleAdapter.getAccessToken(req.body.code)
      console.log('[singin] got access token, get user info')
      const {id, email, name, picture} = await googleAdapter.getUserInfo(googleToken)
      console.log('[singin] got user info')

      console.log('[singin] upsert user')
      let user: User | undefined
      user = await userRepo.getById(id)
      console.log('[singin] got existing user', user?.name)
      if (!user) user = await userRepo.create(id, email, name, picture)
      console.log('[singin] upserted user', user.name)

      const authToken = new AuthToken(user.id, user.tokenRefreshCount)

      res.cookie(CookieNames.AuthToken, authToken.sign(authTokenSecret), authTokenCookieOptions)
      res.json({user})
      return
    }

    let currentAuthToken: AuthToken | undefined
    if (req.cookies[CookieNames.AuthToken]) {
      try {
        currentAuthToken = AuthToken.fromString(req.cookies[CookieNames.AuthToken], authTokenSecret)
      } catch (err) {}
    }

    if (currentAuthToken) {
      const user = await userRepo.getById(currentAuthToken.userId)
      if (user) {
        if (user.tokenRefreshCount !== currentAuthToken.count) {
          res.status(400).send('Token has been invalidated')
          return
        }
        const authToken = new AuthToken(user.id, user.tokenRefreshCount)

        res.cookie(CookieNames.AuthToken, authToken.sign(authTokenSecret), authTokenCookieOptions)
        res.json({user})
        return
      }
    }

    res.cookie(CookieNames.AuthToken, '')
    res.status(200).send('Not authenticated')
  } catch (err) {
    console.log(err)
    res.cookie(CookieNames.AuthToken, '')
    res.status(500).send('Something went wrong')
  }
})

app.post('/signout', (req, res) => {
  res.cookie(CookieNames.AuthToken, '')
  res.send()
})

server.listen(3000, () => console.log('server started on port 3000'))
