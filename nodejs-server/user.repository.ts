import * as retry from 'async-retry'
import {injectable, postConstruct} from 'inversify'
import {createPool, Pool, RowDataPacket} from 'mysql2/promise'

import {Config} from '@libs/config'
import {User} from '@libs/schema'
import {Timestamp} from '@libs/types'

enum Column {
  Id = 'id',
  Email = 'email',
  Name = 'name',
  Picture = 'picture',
  CreatedAt = 'created_at',
  TokenRefreshCount = 'token_refresh_count',
}

// FIXME base mysql repository abstract class

@injectable()
export class UserRepository {
  private pool!: Pool
  private isInitialized = false
  private isConnected = false
  private tableName = 'users'

  constructor(private config: Config) {}

  @postConstruct()
  async initialize() {
    this.pool = createPool({
      host: this.config.get('MYSQL_HOST'),
      port: Number(this.config.get('MYSQL_PORT')),
      user: this.config.get('MYSQL_USER'),
      password: this.config.get('MYSQL_PASSWORD'),
      database: this.config.get('MYSQL_DATABASE'),
    })

    this.pool.on('connection', connection => {
      this.isConnected = true
      connection.on('end', () => {
        this.isConnected = false
        this.isInitialized = false
      })
    })

    const upsertEventsTable = `
      CREATE TABLE IF NOT EXISTS \`${this.tableName}\` (
        ${Column.Id} VARCHAR(255) NOT NULL,
        ${Column.Email} VARCHAR(255) NOT NULL UNIQUE,
        ${Column.Name} VARCHAR(255) NOT NULL,
        ${Column.Picture} VARCHAR(255) NOT NULL,
        ${Column.CreatedAt} BIGINT NOT NULL,
        ${Column.TokenRefreshCount} INT NOT NULL,
        PRIMARY KEY (${Column.Id}),
        INDEX (${Column.Email})
      ) ENGINE=InnoDB;
    `
    const connection = await this.getConnection(true)
    await connection.query(upsertEventsTable)
    connection.release()

    this.isInitialized = true

    console.log('user repository initialized')
  }

  async create(id: string, email: string, name: string, picture: string) {
    const query = `
      INSERT INTO \`${this.tableName}\`
        (${Column.Id}, ${Column.Email}, ${Column.Name}, ${Column.Picture}, ${Column.CreatedAt}, ${Column.TokenRefreshCount})
      VALUES
        (?, ?, ?, ?, ?, ?);
    `
    const connection = await this.getConnection()
    await connection.query(query, [id, email, name, picture, Timestamp.now().toNumber(), 0])
    return this.getByIdOrFail(id)
  }

  async getByIdOrFail(id: string) {
    const user = await this.getById(id)
    if (!user) throw new Error('User not found')
    return user
  }

  async getById(id: string) {
    const query = `
      SELECT *
      FROM \`${this.tableName}\`
      WHERE ${Column.Id} = ?
      LIMIT 1;
    `
    console.log('[user.getById] get connection...')
    const connection = await this.getConnection()
    console.log('[user.getById] got connection')
    const result = await connection.query(query, [id])
    console.log('[user.getById]', {result})
    connection.release()

    const rows = result[0] as RowDataPacket
    const user = rows[0]
    if (!user) return undefined
    return this.deserialize(user)
  }

  async getByIds(ids: string[]) {
    if (ids.length === 0) return []
    // const where = `${Column.Id}=? or `.repeat(ids.length).slice(0, -4)
    let where = ''
    ids.forEach(id => (where += id + ','))
    where = where.slice(0, -1)
    const query = `
      SELECT *
      FROM \`${this.tableName}\`
      WHERE ${Column.Id} in (${where});
    `
    console.log({query, ids})
    const connection = await this.getConnection()
    const result = await connection.query(query, [ids])
    connection.release()

    const rows = result[0] as RowDataPacket
    return rows.map(this.deserialize) as User[]
  }

  async isHealthy() {
    return this.isInitialized && this.isConnected
  }

  async disconnect() {
    await this.pool.end()
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private deserialize(row: any): User {
    return {
      id: row[Column.Id],
      email: row[Column.Email],
      name: row[Column.Name],
      picture: row[Column.Picture],
      createdAt: row[Column.CreatedAt],
      tokenRefreshCount: row[Column.TokenRefreshCount],
    }
  }

  private async getConnection(skipInitCheck = false) {
    try {
      if (!this.isInitialized && !skipInitCheck) {
        console.log('[user.getConnection] retry: wait until initialized')
        await retry(() => {
          if (!this.isInitialized) throw new Error()
        })
      }
      const connection = await retry(() => {
        console.log('[user.getConnection] retry to get connection')
        return this.pool.getConnection()
      })
      return connection
    } catch (err) {
      console.log('[user.getConnection] error', err)
      throw err
    }
  }
}
