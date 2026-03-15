import mysql, { type PoolConnection } from "mysql2/promise";
import { schemaSql } from "./schemaSql.js";

const databaseHost = process.env.DB_HOST || "127.0.0.1";
const databasePort = Number(process.env.DB_PORT || 3306);
const databaseUser = process.env.DB_USER || "root";
const databasePassword = process.env.DB_PASSWORD || "root";
const databaseName = process.env.DB_NAME || "navlight_mapper";

export const pool = mysql.createPool({
  host: databaseHost,
  port: databasePort,
  user: databaseUser,
  password: databasePassword,
  database: databaseName,
  connectionLimit: 10,
  waitForConnections: true,
  queueLimit: 0,
  multipleStatements: true
});

let schemaReady = false;

export async function ensureSchema(): Promise<void> {
  if (schemaReady) {
    return;
  }

  const connection = await pool.getConnection();
  try {
    await connection.query(schemaSql);
    schemaReady = true;
  } finally {
    connection.release();
  }
}

export async function withTransaction<T>(
  callback: (connection: PoolConnection) => Promise<T>
): Promise<T> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
