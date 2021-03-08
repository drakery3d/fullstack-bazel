import {Injectable} from '@angular/core'
import {Actions, createEffect, ofType} from '@ngrx/effects'
import {filter, map} from 'rxjs/operators'

import {DiscussionsMessagesIn, DiscussionsMessagesOut} from '@libs/enums'
import {Message} from '@libs/schema'
import {WebSocketActions} from '@libs/websocket-store'

import {DiscussionsActions} from './discussions.actions'

@Injectable()
export class DiscussionsEffects {
  constructor(private actions$: Actions) {}

  sendMessage$ = createEffect(() =>
    this.actions$.pipe(
      ofType(DiscussionsActions.sendMessage),
      map(({content}) =>
        WebSocketActions.send({name: DiscussionsMessagesIn.SendMessage, payload: content}),
      ),
    ),
  )

  receiveMessage$ = createEffect(() =>
    this.actions$.pipe(
      ofType(WebSocketActions.message),
      filter(({name}) => name === DiscussionsMessagesOut.ReceiveMessage),
      map(({payload}) => DiscussionsActions.receivedMessage({message: payload as Message})),
    ),
  )

  existingMessages$ = createEffect(() =>
    this.actions$.pipe(
      ofType(WebSocketActions.message),
      filter(({name}) => name === DiscussionsMessagesOut.ExistingMessages),
      map(({payload}) =>
        DiscussionsActions.loadedExistingMessages({messages: payload as Message[]}),
      ),
    ),
  )
}