import * as retry from 'async-retry'
import {injectable, postConstruct} from 'inversify'
import {createPool, Pool, RowDataPacket} from 'mysql2/promise'

import {Config} from '@libs/config'
import {Message} from '@libs/schema'
import {Id, Timestamp} from '@libs/types'

enum Column {
  Id = 'id',
  Content = 'content',
  UserId = 'user_id',
  CreatedAt = 'created_at',
}

@injectable()
export class MessagesRepository {
  private pool!: Pool
  private isInitialized = false
  private isConnected = false
  private tableName = 'messages'

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
        ${Column.Content} TEXT NOT NULL,
        ${Column.UserId} VARCHAR(255) NOT NULL,
        ${Column.CreatedAt} BIGINT NOT NULL,
        PRIMARY KEY (${Column.Id})
      ) ENGINE=InnoDB;
    `
    const connection = await this.getConnection(true)
    await connection.query(upsertEventsTable)
    connection.release()

    this.isInitialized = true

    console.log('messages repository initialized')
  }

  // TODO check userId
  async create(content: string, userId: string) {
    const query = `
      INSERT INTO \`${this.tableName}\`
        (${Column.Id}, ${Column.Content}, ${Column.UserId}, ${Column.CreatedAt})
      VALUES
        (?, ?, ?, ?);
    `
    const connection = await this.getConnection()
    const id = Id.generate()
    await connection.query(query, [id.toString(), content, userId, Timestamp.now().toNumber()])
    return this.getByIdOrFail(id)
  }

  async getAll() {
    const query = `
      SELECT *
      FROM \`${this.tableName}\`
      ORDER BY ${Column.CreatedAt} ASC;
    `
    const connection = await this.getConnection()
    const result = await connection.query(query)
    connection.release()

    const rows = result[0] as RowDataPacket
    return rows.map(this.deserialize) as Message[]
  }

  async getByIdOrFail(id: Id) {
    const user = await this.getById(id)
    if (!user) throw new Error('Message not found')
    return user
  }

  async getById(id: Id) {
    const query = `
      SELECT *
      FROM \`${this.tableName}\`
      WHERE ${Column.Id} = ?
      LIMIT 1;
    `
    const connection = await this.getConnection()
    const result = await connection.query(query, [id.toString()])
    connection.release()

    const rows = result[0] as RowDataPacket
    const message = rows[0]
    if (!message) return undefined
    return this.deserialize(message)
  }

  async isHealthy() {
    return this.isInitialized && this.isConnected
  }

  async disconnect() {
    await this.pool.end()
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private deserialize(row: any): Message {
    return {
      id: row[Column.Id],
      content: row[Column.Content],
      userId: row[Column.UserId],
      createdAt: row[Column.CreatedAt],
    }
  }

  private async getConnection(skipInitCheck = false) {
    if (!this.isInitialized && !skipInitCheck) {
      await retry(() => {
        if (!this.isInitialized) throw new Error()
      })
    }
    const connection = await retry(() => {
      return this.pool.getConnection()
    })
    return connection
  }
}
