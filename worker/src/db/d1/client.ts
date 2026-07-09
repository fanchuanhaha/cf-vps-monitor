import type {
  AuditLogsPage, BoundedTableRowCounts, ClearAllRecordsResult, Client, ClientCapacityCounts,
  ClientIdentity, ClientReferenceCleanupResult, ClientTokenMeta, ClientVisibility,
  DeleteClientsResult, DeleteOldRowsOptions, ExpiryNotification, ExpiryNotificationUpdate,
  GPUHistoryRecord, GPUInfo, HistoryTableRowCounts, LoadMetricWindowStats,
  LoadNotification, LoadNotificationInput, LoadNotificationMetric, LoginRateLimit,
  MonitorRecord, OfflineNotification, OfflineNotificationUpdate,
  OrphanClientDataCleanupResult, PagedResult, PingHistoryRecord, PingSnapshotInput,
  PingTask, PingTaskEstimateRow, PingTaskHistoryRequest, PublicClientRow,
  PublicWebsiteMonitor, ScheduledClientRow, TableRowCounts, Theme, ThemeAsset,
  ThemeAssetUpsertInput, ThemeUpsertInput, User, WebsiteCheck, WebsiteCheckInput,
  WebsiteMonitor, WebsiteMonitorInput,
} from '../types.ts';
import type { BackupData } from '../../utils/backup.ts';
import { redactDatabaseSecrets } from '../../utils/setup-diagnostics.ts';
import { generateAgentToken, hashAgentToken } from '../../utils/client.ts';

export type D1Env = {
  DB: D1Database;
};

export class D1ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'D1ConfigurationError';
  }
}

export function isD1Configured(env: D1Env): boolean {
  return Boolean(env.DB);
}

// --- Helpers ---

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const n = v.trim().toLowerCase();
    return n === 'true' || n === '1';
  }
  return false;
}

function fromBool(v: boolean): number {
  return v ? 1 : 0;
}

function parseJsonField<T>(v: unknown): T {
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return v as unknown as T; }
  }
  return v as T;
}

function normalizeClientBooleans<T extends { hidden?: unknown; auto_renewal?: unknown } | null>(client: T): T {
  if (!client || typeof client !== 'object') return client;
  return {
    ...client,
    ...('hidden' in (client as object) ? { hidden: toBool((client as Record<string, unknown>).hidden) } : {}),
    ...('auto_renewal' in (client as object) ? { auto_renewal: toBool((client as Record<string, unknown>).auto_renewal) } : {}),
  } as T;
}

function normalizeClientList<T extends { hidden?: unknown; auto_renewal?: unknown }>(clients: T[]): T[] {
  return clients.map(normalizeClientBooleans);
}

function normalizePingTask<T extends { clients?: unknown; all_clients?: unknown }>(task: T): T {
  return {
    ...task,
    clients: parseJsonField<string[]>((task as Record<string, unknown>).clients),
    all_clients: toBool((task as Record<string, unknown>).all_clients),
  } as T;
}

function normalizePingTaskList<T extends { clients?: unknown; all_clients?: unknown }>(tasks: T[]): T[] {
  return tasks.map(normalizePingTask);
}

function normalizeWebsiteMonitor<T extends { agent_probe_clients?: unknown; agent_probe_status_enabled?: unknown }>(m: T): T {
  return {
    ...m,
    agent_probe_clients: parseJsonField<string[]>((m as Record<string, unknown>).agent_probe_clients),
    agent_probe_status_enabled: toBool((m as Record<string, unknown>).agent_probe_status_enabled),
  } as T;
}

function normalizeWebsiteMonitorList<T extends { agent_probe_clients?: unknown; agent_probe_status_enabled?: unknown }>(monitors: T[]): T[] {
  return monitors.map(normalizeWebsiteMonitor);
}

// --- Client row mapper ---
function mapClientRow(row: Record<string, unknown>): Client {
  return {
    uuid: row.uuid as string,
    token: (row.token as string) || '',
    token_hash: (row.token_hash as string) || '',
    token_last_used_at: (row.token_last_used_at as string) || null,
    token_last_used_ip: (row.token_last_used_ip as string) || '',
    token_rotated_at: (row.token_rotated_at as string) || null,
    name: (row.name as string) || '',
    cpu_name: (row.cpu_name as string) || '',
    virtualization: (row.virtualization as string) || '',
    arch: (row.arch as string) || '',
    cpu_cores: Number(row.cpu_cores || 0),
    os: (row.os as string) || '',
    kernel_version: (row.kernel_version as string) || '',
    gpu_name: (row.gpu_name as string) || '',
    ipv4: (row.ipv4 as string) || '',
    ipv6: (row.ipv6 as string) || '',
    region: (row.region as string) || '',
    remark: (row.remark as string) || '',
    public_remark: (row.public_remark as string) || '',
    mem_total: Number(row.mem_total || 0),
    swap_total: Number(row.swap_total || 0),
    disk_total: Number(row.disk_total || 0),
    version: (row.version as string) || '',
    price: Number(row.price || 0),
    billing_cycle: Number(row.billing_cycle || 0),
    auto_renewal: toBool(row.auto_renewal),
    currency: (row.currency as string) || '$',
    expired_at: (row.expired_at as string) || '',
    group: (row.group as string) || '',
    tags: (row.tags as string) || '',
    hidden: toBool(row.hidden),
    traffic_limit: Number(row.traffic_limit || 0),
    traffic_limit_type: (row.traffic_limit_type as string) || 'max',
    sort_order: Number(row.sort_order || 0),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

// =============================================================================
// Settings
// =============================================================================

export async function getD1PublicSettings(db: D1Database): Promise<Record<string, string>> {
  const result = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  return Object.fromEntries(result.results.map(r => [r.key, r.value]));
}

export async function setD1Settings(db: D1Database, settings: Record<string, string>): Promise<void> {
  const batch: D1PreparedStatement[] = [];
  for (const [key, value] of Object.entries(settings)) {
    batch.push(db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value));
  }
  await db.batch(batch);
}

// =============================================================================
// Clients
// =============================================================================

export async function getD1PublicClients(db: D1Database): Promise<PublicClientRow[]> {
  const result = await db.prepare(`
    SELECT uuid, name, cpu_name, virtualization, arch, cpu_cores, os, kernel_version,
           gpu_name, ipv4, ipv6, region, public_remark, mem_total, swap_total, disk_total,
           version, price, billing_cycle, auto_renewal, currency, expired_at, "group", tags,
           hidden, traffic_limit, traffic_limit_type, sort_order, created_at, updated_at
    FROM clients ORDER BY sort_order, name
  `).all<Record<string, unknown>>();
  return result.results.map(r => normalizeClientBooleans({
    ...r,
    auto_renewal: toBool(r.auto_renewal),
    hidden: toBool(r.hidden),
  } as unknown as PublicClientRow));
}

export async function getD1AdminClients(db: D1Database): Promise<Client[]> {
  const result = await db.prepare('SELECT * FROM clients ORDER BY sort_order, name').all<Record<string, unknown>>();
  return normalizeClientList(result.results.map(mapClientRow));
}

export async function d1ClientExists(db: D1Database, uuid: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS exists FROM clients WHERE uuid = ?').bind(uuid).first<{ exists: number }>();
  return row !== null;
}

export async function getD1Client(db: D1Database, uuid: string): Promise<Client | null> {
  const row = await db.prepare('SELECT * FROM clients WHERE uuid = ?').bind(uuid).first<Record<string, unknown>>();
  return row ? normalizeClientBooleans(mapClientRow(row)) : null;
}

export async function getD1ClientVisibility(db: D1Database, uuid: string): Promise<ClientVisibility | null> {
  const row = await db.prepare('SELECT uuid, hidden FROM clients WHERE uuid = ?').bind(uuid).first<{ uuid: string; hidden: number }>();
  return row ? { uuid: row.uuid, hidden: toBool(row.hidden) } : null;
}

export async function listD1ScheduledClientRows(db: D1Database): Promise<ScheduledClientRow[]> {
  const result = await db.prepare('SELECT uuid, name, created_at, expired_at FROM clients').all<ScheduledClientRow>();
  return result.results;
}

export async function getD1ScheduledClientRowsByIds(db: D1Database, uuids: string[]): Promise<ScheduledClientRow[]> {
  if (uuids.length === 0) return [];
  const placeholders = uuids.map(() => '?').join(',');
  const result = await db.prepare(`SELECT uuid, name, created_at, expired_at FROM clients WHERE uuid IN (${placeholders})`)
    .bind(...uuids).all<ScheduledClientRow>();
  return result.results;
}

export async function getD1ClientTokenMeta(db: D1Database, uuid: string): Promise<ClientTokenMeta | null> {
  const row = await db.prepare('SELECT uuid, token, token_hash, name FROM clients WHERE uuid = ?').bind(uuid)
    .first<ClientTokenMeta>();
  return row || null;
}

export async function getD1ClientsByIds(db: D1Database, uuids: string[]): Promise<Client[]> {
  if (uuids.length === 0) return [];
  const placeholders = uuids.map(() => '?').join(',');
  const result = await db.prepare(`SELECT * FROM clients WHERE uuid IN (${placeholders}) ORDER BY sort_order, name`)
    .bind(...uuids).all<Record<string, unknown>>();
  return normalizeClientList(result.results.map(mapClientRow));
}

export async function getD1ClientIds(db: D1Database): Promise<string[]> {
  const result = await db.prepare('SELECT uuid FROM clients ORDER BY sort_order, name').all<{ uuid: string }>();
  return result.results.map(r => r.uuid);
}

export async function getD1ClientByToken(db: D1Database, token: string): Promise<Client | null> {
  const tokenHash = await hashAgentToken(token);
  const row = await db.prepare('SELECT * FROM clients WHERE token_hash = ?').bind(tokenHash).first<Record<string, unknown>>();
  return row ? normalizeClientBooleans(mapClientRow(row)) : null;
}

export async function getD1ClientIdentityByToken(db: D1Database, token: string): Promise<ClientIdentity | null> {
  const tokenHash = await hashAgentToken(token);
  const row = await db.prepare(
    'SELECT uuid, token, token_last_used_ip, token_rotated_at, created_at, name, hidden FROM clients WHERE token_hash = ?'
  ).bind(tokenHash).first<Record<string, unknown>>();
  return row ? { ...row, hidden: toBool(row.hidden) } as unknown as ClientIdentity : null;
}

export async function d1ClientTokenExists(db: D1Database, token: string): Promise<boolean> {
  const tokenHash = await hashAgentToken(token);
  const row = await db.prepare('SELECT 1 AS exists FROM clients WHERE token_hash = ?').bind(tokenHash).first<{ exists: number }>();
  return row !== null;
}

export async function getD1ClientCreateConflict(db: D1Database, uuid: string, token: string): Promise<'uuid' | 'token' | null> {
  const uuidRow = await db.prepare('SELECT 1 AS exists FROM clients WHERE uuid = ?').bind(uuid).first<{ exists: number }>();
  if (uuidRow) return 'uuid';
  const tokenHash = await hashAgentToken(token);
  const tokenRow = await db.prepare('SELECT 1 AS exists FROM clients WHERE token_hash = ?').bind(tokenHash).first<{ exists: number }>();
  if (tokenRow) return 'token';
  return null;
}

export async function createD1Client(db: D1Database, client: Partial<Client>): Promise<Client> {
  const token = client.token || generateAgentToken();
  const tokenHash = client.token_hash || await hashAgentToken(token);
  const uuid = client.uuid || crypto.randomUUID();
  const now = new Date().toISOString();
  const maxOrder = await db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM clients').first<{ next_order: number }>();
  const sortOrder = client.sort_order ?? (maxOrder?.next_order ?? 1);

  await db.prepare(`
    INSERT INTO clients (uuid, token, token_hash, token_rotated_at, name, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(uuid, token, tokenHash, now, client.name || '', sortOrder, now, now).run();

  const row = await db.prepare('SELECT * FROM clients WHERE uuid = ?').bind(uuid).first<Record<string, unknown>>();
  return normalizeClientBooleans(mapClientRow(row!));
}

export async function markD1ClientTokenUsed(db: D1Database, uuid: string, ip = ''): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db.prepare(
    'UPDATE clients SET token_last_used_at = ?, token_last_used_ip = ?, updated_at = ? WHERE uuid = ?'
  ).bind(now, ip, now, uuid).run();
  return result.meta.changes > 0;
}

export async function rotateD1ClientToken(db: D1Database, uuid: string, token: string): Promise<Client | null> {
  const tokenHash = await hashAgentToken(token);
  const now = new Date().toISOString();
  await db.prepare(`
    UPDATE clients SET token = ?, token_hash = ?, token_last_used_at = NULL, token_last_used_ip = '',
    token_rotated_at = ?, updated_at = ? WHERE uuid = ?
  `).bind(token, tokenHash, now, now, uuid).run();
  const row = await db.prepare('SELECT * FROM clients WHERE uuid = ?').bind(uuid).first<Record<string, unknown>>();
  return row ? normalizeClientBooleans(mapClientRow(row)) : null;
}

export async function updateD1Client(db: D1Database, uuid: string, data: Partial<Client> | Record<string, unknown>): Promise<boolean> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const now = new Date().toISOString();

  for (const [key, value] of Object.entries(data)) {
    if (key === 'uuid' || key === 'token_hash') continue;
    if (key === 'hidden' || key === 'auto_renewal') {
      sets.push(`${key} = ?`);
      values.push(fromBool(Boolean(value)));
    } else {
      sets.push(`${key} = ?`);
      values.push(value ?? '');
    }
  }
  sets.push('updated_at = ?');
  values.push(now);
  values.push(uuid);

  const result = await db.prepare(`UPDATE clients SET ${sets.join(', ')} WHERE uuid = ?`).bind(...values).run();
  return result.meta.changes > 0;
}

export async function updateD1ClientAndReturn(db: D1Database, uuid: string, data: Partial<Client> | Record<string, unknown>): Promise<Client | null> {
  await updateD1Client(db, uuid, data);
  return getD1Client(db, uuid);
}

export async function deleteD1Clients(db: D1Database, uuids: string[]): Promise<DeleteClientsResult> {
  if (uuids.length === 0) return { removed: 0, deleted_records: { records: 0, gpu_records: 0, gpu_snapshots: 0, ping_records: 0, ping_snapshots: 0 } };
  const placeholders = uuids.map(() => '?').join(',');
  const deletedRecords = await db.prepare(`DELETE FROM records WHERE client IN (${placeholders})`).bind(...uuids).run();
  const deletedGpuRecords = await db.prepare(`DELETE FROM gpu_records WHERE client IN (${placeholders})`).bind(...uuids).run();
  const deletedGpuSnapshots = await db.prepare(`DELETE FROM gpu_snapshots WHERE client IN (${placeholders})`).bind(...uuids).run();
  const deletedPingRecords = await db.prepare(`DELETE FROM ping_records WHERE client IN (${placeholders})`).bind(...uuids).run();
  const deletedPingSnapshots = await db.prepare(`DELETE FROM ping_snapshots WHERE client IN (${placeholders})`).bind(...uuids).run();
  const removed = await db.prepare(`DELETE FROM clients WHERE uuid IN (${placeholders})`).bind(...uuids).run();

  return {
    removed: removed.meta.changes,
    deleted_records: {
      records: deletedRecords.meta.changes,
      gpu_records: deletedGpuRecords.meta.changes,
      gpu_snapshots: deletedGpuSnapshots.meta.changes,
      ping_records: deletedPingRecords.meta.changes,
      ping_snapshots: deletedPingSnapshots.meta.changes,
    },
  };
}

export async function pruneD1ClientReferences(db: D1Database, uuid: string): Promise<ClientReferenceCleanupResult> {
  return pruneD1ClientReferencesForClients(db, [uuid]);
}

export async function pruneD1ClientReferencesForClients(db: D1Database, uuids: string[]): Promise<ClientReferenceCleanupResult> {
  if (uuids.length === 0) return { ping_tasks_updated: 0, load_notifications_updated: 0, load_notifications_deleted: 0, expiry_notifications_deleted: 0 };
  const placeholders = uuids.map(() => '?').join(',');
  let pingTasksUpdated = 0;
  let loadNotificationsUpdated = 0;
  let loadNotificationsDeleted = 0;
  let expiryNotificationsDeleted = 0;

  // Remove client from ping_task clients JSON arrays
  const pingTasks = await db.prepare('SELECT id, clients FROM ping_tasks').all<{ id: number; clients: string }>();
  for (const task of pingTasks.results) {
    const clients: string[] = JSON.parse(task.clients || '[]');
    const newClients = clients.filter(c => !uuids.includes(c));
    if (newClients.length !== clients.length) {
      await db.prepare('UPDATE ping_tasks SET clients = ? WHERE id = ?').bind(JSON.stringify(newClients), task.id).run();
      pingTasksUpdated++;
    }
  }

  // Remove client from load_notification clients
  const loadNotifications = await db.prepare('SELECT id, clients FROM load_notifications').all<{ id: number; clients: string }>();
  for (const ln of loadNotifications.results) {
    const clients: string[] = JSON.parse(ln.clients || '[]');
    const newClients = clients.filter(c => !uuids.includes(c));
    if (newClients.length !== clients.length) {
      if (newClients.length === 0) {
        await db.prepare('DELETE FROM load_notifications WHERE id = ?').bind(ln.id).run();
        loadNotificationsDeleted++;
      } else {
        await db.prepare('UPDATE load_notifications SET clients = ? WHERE id = ?').bind(JSON.stringify(newClients), ln.id).run();
        loadNotificationsUpdated++;
      }
    }
  }

  // Delete expiry notifications for removed clients
  const expiryResult = await db.prepare(`DELETE FROM expiry_notifications WHERE client IN (${placeholders})`).bind(...uuids).run();
  expiryNotificationsDeleted = expiryResult.meta.changes;

  return { ping_tasks_updated: pingTasksUpdated, load_notifications_updated: loadNotificationsUpdated, load_notifications_deleted: loadNotificationsDeleted, expiry_notifications_deleted: expiryNotificationsDeleted };
}

export async function cleanupD1OrphanClientData(db: D1Database): Promise<OrphanClientDataCleanupResult> {
  // Delete records referencing non-existent clients
  const orphanRecords = await db.prepare('DELETE FROM records WHERE client NOT IN (SELECT uuid FROM clients)').run();
  const orphanGpuRecords = await db.prepare('DELETE FROM gpu_records WHERE client NOT IN (SELECT uuid FROM clients)').run();
  const orphanGpuSnapshots = await db.prepare('DELETE FROM gpu_snapshots WHERE client NOT IN (SELECT uuid FROM clients)').run();
  const orphanPingRecords = await db.prepare('DELETE FROM ping_records WHERE client NOT IN (SELECT uuid FROM clients)').run();
  const orphanPingSnapshots = await db.prepare('DELETE FROM ping_snapshots WHERE client NOT IN (SELECT uuid FROM clients)').run();
  const orphanOffline = await db.prepare('DELETE FROM offline_notifications WHERE client NOT IN (SELECT uuid FROM clients)').run();
  const orphanExpiry = await db.prepare('DELETE FROM expiry_notifications WHERE client NOT IN (SELECT uuid FROM clients)').run();
  await db.prepare('DELETE FROM website_checks WHERE source_client IS NOT NULL AND source_client NOT IN (SELECT uuid FROM clients)').run();

  return {
    ping_tasks_updated: 0,
    load_notifications_updated: 0,
    load_notifications_deleted: 0,
    expiry_notifications_deleted: orphanExpiry.meta.changes,
    offline_notifications_deleted: orphanOffline.meta.changes,
    records_deleted: orphanRecords.meta.changes,
    gpu_records_deleted: orphanGpuRecords.meta.changes,
    gpu_snapshots_deleted: orphanGpuSnapshots.meta.changes,
    ping_records_deleted: orphanPingRecords.meta.changes,
    ping_snapshots_deleted: orphanPingSnapshots.meta.changes,
  };
}

export async function updateD1ClientsHidden(db: D1Database, uuids: string[], hidden: boolean): Promise<number> {
  if (uuids.length === 0) return 0;
  const placeholders = uuids.map(() => '?').join(',');
  const result = await db.prepare(`UPDATE clients SET hidden = ?, updated_at = ? WHERE uuid IN (${placeholders})`)
    .bind(fromBool(hidden), new Date().toISOString(), ...uuids).run();
  return result.meta.changes;
}

export async function reorderD1Clients(db: D1Database, uuids: string[]): Promise<number> {
  let count = 0;
  for (let i = 0; i < uuids.length; i++) {
    const result = await db.prepare('UPDATE clients SET sort_order = ?, updated_at = ? WHERE uuid = ?')
      .bind(i + 1, new Date().toISOString(), uuids[i]).run();
    count += result.meta.changes;
  }
  return count;
}

export async function getD1ClientCapacityCounts(db: D1Database): Promise<ClientCapacityCounts> {
  const clients = await db.prepare('SELECT COUNT(*) AS count FROM clients').first<{ count: number }>();
  const gpuClients = await db.prepare("SELECT COUNT(*) AS count FROM clients WHERE gpu_name != ''").first<{ count: number }>();
  return { clients: clients?.count ?? 0, gpu_clients: gpuClients?.count ?? 0 };
}

// =============================================================================
// Ping Tasks
// =============================================================================

export async function getD1PingTaskEstimateRows(db: D1Database): Promise<PingTaskEstimateRow[]> {
  const result = await db.prepare('SELECT id, name, clients, all_clients, interval_sec FROM ping_tasks ORDER BY sort_order, id').all<Record<string, unknown>>();
  return normalizePingTaskList(result.results as unknown as PingTaskEstimateRow[]);
}

export async function getD1PingTask(db: D1Database, id: number): Promise<PingTask | null> {
  const row = await db.prepare('SELECT * FROM ping_tasks WHERE id = ?').bind(id).first<Record<string, unknown>>();
  return row ? normalizePingTask({
    ...row,
    clients: parseJsonField<string[]>(row.clients),
    all_clients: toBool(row.all_clients),
  } as unknown as PingTask) : null;
}

export async function createD1PingTask(db: D1Database, task: PingTask): Promise<PingTask> {
  const maxOrder = await db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM ping_tasks').first<{ next_order: number }>();
  const sortOrder = task.sort_order ?? (maxOrder?.next_order ?? 1);
  const result = await db.prepare(
    'INSERT INTO ping_tasks (name, clients, all_clients, type, target, interval_sec, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(task.name, JSON.stringify(task.clients || []), fromBool(task.all_clients), task.type, task.target, task.interval_sec, sortOrder).run();
  return (await getD1PingTask(db, result.meta.last_row_id as number))!;
}

export async function updateD1PingTaskAndReturn(db: D1Database, id: number, task: Partial<PingTask>): Promise<PingTask | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(task)) {
    if (key === 'id') continue;
    if (key === 'clients') {
      sets.push('clients = ?');
      values.push(JSON.stringify(value || []));
    } else if (key === 'all_clients') {
      sets.push('all_clients = ?');
      values.push(fromBool(Boolean(value)));
    } else {
      sets.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (sets.length === 0) return getD1PingTask(db, id);
  values.push(id);
  await db.prepare(`UPDATE ping_tasks SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
  return getD1PingTask(db, id);
}

export async function reorderD1PingTasks(db: D1Database, ids: number[]): Promise<number> {
  let count = 0;
  for (let i = 0; i < ids.length; i++) {
    const result = await db.prepare('UPDATE ping_tasks SET sort_order = ? WHERE id = ?').bind(i + 1, ids[i]).run();
    count += result.meta.changes;
  }
  return count;
}

export async function deleteD1PingTask(db: D1Database, id: number): Promise<PingTask | null> {
  const task = await getD1PingTask(db, id);
  if (!task) return null;
  await db.prepare('DELETE FROM ping_tasks WHERE id = ?').bind(id).run();
  return task;
}

// =============================================================================
// Records
// =============================================================================

export async function insertD1MonitorRecord(db: D1Database, record: MonitorRecord): Promise<void> {
  await db.prepare(`
    INSERT INTO records (client, time, cpu, gpu, ram, ram_total, swap, swap_total, load, temp, disk, disk_total,
      net_in, net_out, net_total_up, net_total_down, process_count, connections, connections_udp, uptime)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    record.client, record.time, record.cpu, record.gpu, record.ram, record.ram_total,
    record.swap, record.swap_total, record.load, record.temp, record.disk, record.disk_total,
    record.net_in, record.net_out, record.net_total_up, record.net_total_down,
    record.process_count, record.connections, record.connections_udp, record.uptime,
  ).run();
}

export async function insertD1GpuRecords(db: D1Database, client: string, time: string, gpus: GPUInfo[]): Promise<void> {
  // Insert individual GPU records
  const batch: D1PreparedStatement[] = gpus.map(gpu =>
    db.prepare('INSERT INTO gpu_records (client, time, device_index, device_name, mem_total, mem_used, utilization, temperature) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(client, time, gpu.device_index, gpu.device_name, gpu.mem_total, gpu.mem_used, gpu.utilization, gpu.temperature)
  );
  // Insert snapshot
  batch.push(db.prepare('INSERT INTO gpu_snapshots (client, time, devices_json) VALUES (?, ?, ?)')
    .bind(client, time, JSON.stringify(gpus)));
  await db.batch(batch);
}

export async function insertD1PingSnapshot(db: D1Database, client: string, time: string, results: PingSnapshotInput[]): Promise<void> {
  const batch: D1PreparedStatement[] = results.map(r =>
    db.prepare('INSERT INTO ping_records (client, task_id, time, value) VALUES (?, ?, ?, ?)')
      .bind(client, r.taskId, time, r.value)
  );
  batch.push(db.prepare('INSERT INTO ping_snapshots (client, time, values_json) VALUES (?, ?, ?)')
    .bind(client, time, JSON.stringify(results)));
  await db.batch(batch);
}

export async function getD1RecentRecords(db: D1Database, client: string, limit: number): Promise<MonitorRecord[]> {
  const result = await db.prepare('SELECT * FROM records WHERE client = ? ORDER BY time DESC LIMIT ?').bind(client, limit).all<Record<string, unknown>>();
  return result.results.map(r => ({ ...r }) as unknown as MonitorRecord);
}

export async function getD1LatestRecords(db: D1Database): Promise<MonitorRecord[]> {
  // Get the latest record for each client
  const result = await db.prepare(`
    SELECT r.* FROM records r
    INNER JOIN (SELECT client, MAX(time) AS max_time FROM records GROUP BY client) latest
    ON r.client = latest.client AND r.time = latest.max_time
  `).all<Record<string, unknown>>();
  return result.results.map(r => ({ ...r }) as unknown as MonitorRecord);
}

export async function getD1LatestRecordTimes(db: D1Database): Promise<Array<{ client: string; last_time: string }>> {
  const result = await db.prepare('SELECT client, MAX(time) AS last_time FROM records GROUP BY client').all<{ client: string; last_time: string }>();
  return result.results;
}

export async function getD1LatestRecordTimesForClients(db: D1Database, clients: string[]): Promise<Array<{ client: string; last_time: string }>> {
  if (clients.length === 0) return [];
  const placeholders = clients.map(() => '?').join(',');
  const result = await db.prepare(`SELECT client, MAX(time) AS last_time FROM records WHERE client IN (${placeholders}) GROUP BY client`)
    .bind(...clients).all<{ client: string; last_time: string }>();
  return result.results;
}

export async function getD1RecordsByTimeRange(db: D1Database, client: string, start: string, end: string): Promise<MonitorRecord[]> {
  const result = await db.prepare('SELECT * FROM records WHERE client = ? AND time >= ? AND time <= ? ORDER BY time').bind(client, start, end).all<Record<string, unknown>>();
  return result.results.map(r => ({ ...r }) as unknown as MonitorRecord);
}

export async function getD1RecordsByTimeRangeLimited(db: D1Database, client: string, start: string, end: string, limit: number): Promise<MonitorRecord[]> {
  const result = await db.prepare('SELECT * FROM records WHERE client = ? AND time >= ? AND time <= ? ORDER BY time LIMIT ?').bind(client, start, end, limit).all<Record<string, unknown>>();
  return result.results.map(r => ({ ...r }) as unknown as MonitorRecord);
}

export async function getD1RecordsByTimeRangePaged(db: D1Database, client: string, start: string, end: string, page: number, limit: number): Promise<PagedResult<MonitorRecord>> {
  const countRow = await db.prepare('SELECT COUNT(*) AS total FROM records WHERE client = ? AND time >= ? AND time <= ?').bind(client, start, end).first<{ total: number }>();
  const total = countRow?.total ?? 0;
  const offset = (page - 1) * limit;
  const result = await db.prepare('SELECT * FROM records WHERE client = ? AND time >= ? AND time <= ? ORDER BY time LIMIT ? OFFSET ?').bind(client, start, end, limit, offset).all<Record<string, unknown>>();
  return {
    data: result.results.map(r => ({ ...r }) as unknown as MonitorRecord),
    total,
    page,
    limit,
    has_more: offset + limit < total,
  };
}

export async function getD1RecordsByTimeRangeCursor(db: D1Database, client: string, start: string, end: string, cursor: string | undefined, limit: number): Promise<PagedResult<MonitorRecord>> {
  const countRow = await db.prepare('SELECT COUNT(*) AS total FROM records WHERE client = ? AND time >= ? AND time <= ?').bind(client, start, end).first<{ total: number }>();
  const total = countRow?.total ?? 0;
  let result;
  if (cursor) {
    result = await db.prepare('SELECT * FROM records WHERE client = ? AND time >= ? AND time <= ? AND time > ? ORDER BY time LIMIT ?').bind(client, start, end, cursor, limit).all<Record<string, unknown>>();
  } else {
    result = await db.prepare('SELECT * FROM records WHERE client = ? AND time >= ? AND time <= ? ORDER BY time LIMIT ?').bind(client, start, end, limit).all<Record<string, unknown>>();
  }
  const data = result.results.map(r => ({ ...r }) as unknown as MonitorRecord);
  const nextCursor = data.length === limit && data.length > 0 ? data[data.length - 1].time : undefined;
  return { data, total, page: 1, limit, has_more: Boolean(nextCursor), next_cursor: nextCursor };
}

// =============================================================================
// GPU Records
// =============================================================================

export async function getD1GpuRecords(db: D1Database, client: string, start: string | undefined, end: string | undefined, limit: number): Promise<GPUHistoryRecord[]> {
  let sql = 'SELECT * FROM gpu_records WHERE client = ?';
  const params: unknown[] = [client];
  if (start) { sql += ' AND time >= ?'; params.push(start); }
  if (end) { sql += ' AND time <= ?'; params.push(end); }
  sql += ' ORDER BY time DESC LIMIT ?';
  params.push(limit);
  const result = await db.prepare(sql).bind(...params).all<Record<string, unknown>>();
  return result.results.map(r => ({ ...r }) as unknown as GPUHistoryRecord);
}

export async function getD1GpuRecordsPaged(db: D1Database, client: string, start: string | undefined, end: string | undefined, page: number, limit: number): Promise<PagedResult<GPUHistoryRecord>> {
  let whereClause = 'WHERE client = ?';
  const params: unknown[] = [client];
  if (start) { whereClause += ' AND time >= ?'; params.push(start); }
  if (end) { whereClause += ' AND time <= ?'; params.push(end); }
  const countRow = await db.prepare(`SELECT COUNT(*) AS total FROM gpu_records ${whereClause}`).bind(...params).first<{ total: number }>();
  const total = countRow?.total ?? 0;
  const offset = (page - 1) * limit;
  const result = await db.prepare(`SELECT * FROM gpu_records ${whereClause} ORDER BY time DESC LIMIT ? OFFSET ?`).bind(...params, limit, offset).all<Record<string, unknown>>();
  return {
    data: result.results.map(r => ({ ...r }) as unknown as GPUHistoryRecord),
    total, page, limit,
    has_more: offset + limit < total,
  };
}

export async function getD1GpuRecordsCursor(db: D1Database, client: string, start: string | undefined, end: string | undefined, cursor: string | undefined, limit: number): Promise<PagedResult<GPUHistoryRecord>> {
  let whereClause = 'WHERE client = ?';
  const params: unknown[] = [client];
  if (start) { whereClause += ' AND time >= ?'; params.push(start); }
  if (end) { whereClause += ' AND time <= ?'; params.push(end); }
  const countRow = await db.prepare(`SELECT COUNT(*) AS total FROM gpu_records ${whereClause}`).bind(...params).first<{ total: number }>();
  const total = countRow?.total ?? 0;
  if (cursor) { whereClause += ' AND time < ?'; params.push(cursor); }
  const result = await db.prepare(`SELECT * FROM gpu_records ${whereClause} ORDER BY time DESC LIMIT ?`).bind(...params, limit).all<Record<string, unknown>>();
  const data = result.results.map(r => ({ ...r }) as unknown as GPUHistoryRecord);
  const nextCursor = data.length === limit && data.length > 0 ? data[data.length - 1].time : undefined;
  return { data, total, page: 1, limit, has_more: Boolean(nextCursor), next_cursor: nextCursor };
}

// =============================================================================
// Ping Records
// =============================================================================

export async function getD1PingRecords(db: D1Database, client: string, taskId: number, limit: number): Promise<PingHistoryRecord[]> {
  const result = await db.prepare('SELECT * FROM ping_records WHERE client = ? AND task_id = ? ORDER BY time DESC LIMIT ?').bind(client, taskId, limit).all<Record<string, unknown>>();
  return result.results.map(r => ({ ...r }) as unknown as PingHistoryRecord);
}

export async function getD1PingRecordsPaged(db: D1Database, client: string, taskId: number, page: number, limit: number): Promise<PagedResult<PingHistoryRecord>> {
  const countRow = await db.prepare('SELECT COUNT(*) AS total FROM ping_records WHERE client = ? AND task_id = ?').bind(client, taskId).first<{ total: number }>();
  const total = countRow?.total ?? 0;
  const offset = (page - 1) * limit;
  const result = await db.prepare('SELECT * FROM ping_records WHERE client = ? AND task_id = ? ORDER BY time DESC LIMIT ? OFFSET ?').bind(client, taskId, limit, offset).all<Record<string, unknown>>();
  return {
    data: result.results.map(r => ({ ...r }) as unknown as PingHistoryRecord),
    total, page, limit,
    has_more: offset + limit < total,
  };
}

export async function getD1PingRecordsCursor(db: D1Database, client: string, taskId: number, cursor: string | undefined, limit: number): Promise<PagedResult<PingHistoryRecord>> {
  const countRow = await db.prepare('SELECT COUNT(*) AS total FROM ping_records WHERE client = ? AND task_id = ?').bind(client, taskId).first<{ total: number }>();
  const total = countRow?.total ?? 0;
  let result;
  if (cursor) {
    result = await db.prepare('SELECT * FROM ping_records WHERE client = ? AND task_id = ? AND time < ? ORDER BY time DESC LIMIT ?').bind(client, taskId, cursor, limit).all<Record<string, unknown>>();
  } else {
    result = await db.prepare('SELECT * FROM ping_records WHERE client = ? AND task_id = ? ORDER BY time DESC LIMIT ?').bind(client, taskId, limit).all<Record<string, unknown>>();
  }
  const data = result.results.map(r => ({ ...r }) as unknown as PingHistoryRecord);
  const nextCursor = data.length === limit && data.length > 0 ? data[data.length - 1].time : undefined;
  return { data, total, page: 1, limit, has_more: Boolean(nextCursor), next_cursor: nextCursor };
}

export async function getD1PingRecordsForTasks(db: D1Database, client: string, tasks: number[] | PingTaskHistoryRequest[], limit: number, cursor?: string): Promise<Record<string, PingHistoryRecord[]>> {
  if (tasks.some(task => typeof task !== 'number')) {
    return getD1PingRecordsForTaskSpecs(db, client, tasks as PingTaskHistoryRequest[], limit, cursor);
  }
  const taskIds = tasks as number[];
  if (taskIds.length === 0) return {};
  const placeholders = taskIds.map(() => '?').join(',');
  const params: unknown[] = [client, ...taskIds];
  let sql = `SELECT * FROM ping_records WHERE client = ? AND task_id IN (${placeholders})`;
  if (cursor) { sql += ' AND time < ?'; params.push(cursor); }
  sql += ' ORDER BY time DESC';
  const result = await db.prepare(sql).bind(...params).all<Record<string, unknown>>();
  const grouped: Record<string, PingHistoryRecord[]> = {};
  for (const row of result.results) {
    const record = { ...row } as unknown as PingHistoryRecord;
    const key = String(record.task_id);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(record);
  }
  return grouped;
}

async function getD1PingRecordsForTaskSpecs(db: D1Database, client: string, tasks: PingTaskHistoryRequest[], fallbackLimit: number, cursor?: string): Promise<Record<string, PingHistoryRecord[]>> {
  const entries = await Promise.all(tasks.map(async (task) => {
    const taskLimit = Number.isInteger(task.limit) && task.limit && task.limit > 0 ? Math.min(task.limit, 1000) : fallbackLimit;
    const records = cursor
      ? (await getD1PingRecordsCursor(db, client, task.taskId, cursor, taskLimit)).data
      : await getD1PingRecords(db, client, task.taskId, taskLimit);
    return [String(task.taskId), records] as const;
  }));
  return Object.fromEntries(entries);
}

// =============================================================================
// Users / Auth
// =============================================================================

export async function getD1LoginUser(db: D1Database, username: string): Promise<User | null> {
  const row = await db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<Record<string, unknown>>();
  return row ? { ...row, session_version: Number(row.session_version) } as unknown as User : null;
}

export async function countD1Users(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>();
  return row?.count ?? 0;
}

export async function createD1User(db: D1Database, user: { uuid: string; username: string; hashedPassword: string }): Promise<boolean> {
  const now = new Date().toISOString();
  try {
    await db.prepare('INSERT INTO users (uuid, username, passwd, session_version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)')
      .bind(user.uuid, user.username, user.hashedPassword, now, now).run();
    return true;
  } catch {
    return false;
  }
}

export async function deleteD1UserIfMatches(db: D1Database, user: { uuid: string; username: string; hashedPassword: string }): Promise<boolean> {
  const result = await db.prepare('DELETE FROM users WHERE uuid = ? AND username = ? AND passwd = ?')
    .bind(user.uuid, user.username, user.hashedPassword).run();
  return result.meta.changes > 0;
}

export async function recoverD1SingleAdmin(db: D1Database, user: { uuid: string; username: string; hashedPassword: string }): Promise<User> {
  // Delete all users and create this one
  await db.prepare('DELETE FROM users').run();
  await createD1User(db, user);
  return (await getD1UserByUuid(db, user.uuid))!;
}

export async function getD1UserByUuid(db: D1Database, uuid: string): Promise<User | null> {
  const row = await db.prepare('SELECT * FROM users WHERE uuid = ?').bind(uuid).first<Record<string, unknown>>();
  return row ? { ...row, session_version: Number(row.session_version) } as unknown as User : null;
}

export async function updateD1UserUsername(db: D1Database, uuid: string, username: string): Promise<void> {
  await db.prepare('UPDATE users SET username = ?, updated_at = ? WHERE uuid = ?').bind(username, new Date().toISOString(), uuid).run();
}

export async function updateD1UserUsernameAndRotateSession(db: D1Database, uuid: string, username: string): Promise<User | null> {
  const now = new Date().toISOString();
  await db.prepare('UPDATE users SET username = ?, session_version = session_version + 1, updated_at = ? WHERE uuid = ?').bind(username, now, uuid).run();
  return getD1UserByUuid(db, uuid);
}

export async function updateD1UserPassword(db: D1Database, uuid: string, hashedPassword: string): Promise<void> {
  await db.prepare('UPDATE users SET passwd = ?, password_changed_at = ?, updated_at = ? WHERE uuid = ?')
    .bind(hashedPassword, new Date().toISOString(), new Date().toISOString(), uuid).run();
}

export async function updateD1UserPasswordAndRotateSession(db: D1Database, uuid: string, hashedPassword: string): Promise<User | null> {
  const now = new Date().toISOString();
  await db.prepare('UPDATE users SET passwd = ?, password_changed_at = ?, session_version = session_version + 1, updated_at = ? WHERE uuid = ?')
    .bind(hashedPassword, now, now, uuid).run();
  return getD1UserByUuid(db, uuid);
}

export async function rotateD1UserSession(db: D1Database, uuid: string): Promise<User | null> {
  await db.prepare('UPDATE users SET session_version = session_version + 1, updated_at = ? WHERE uuid = ?')
    .bind(new Date().toISOString(), uuid).run();
  return getD1UserByUuid(db, uuid);
}

export async function validateD1AdminSession(db: D1Database, userId: string, sessionVersion: number): Promise<Pick<User, 'uuid' | 'username' | 'session_version'> | null> {
  const row = await db.prepare('SELECT uuid, username, session_version FROM users WHERE uuid = ? AND session_version = ?')
    .bind(userId, sessionVersion).first<{ uuid: string; username: string; session_version: number }>();
  return row ? { uuid: row.uuid, username: row.username, session_version: row.session_version } : null;
}

export async function ensureD1InitialAdmin(db: D1Database, uuid: string, username: string, hashedPassword: string): Promise<void> {
  const count = await countD1Users(db);
  if (count === 0) {
    await createD1User(db, { uuid, username, hashedPassword });
  }
}

// =============================================================================
// Login Rate Limits
// =============================================================================

export async function getD1LoginRateLimit(db: D1Database, bucket: string): Promise<LoginRateLimit | null> {
  const row = await db.prepare('SELECT * FROM login_rate_limits WHERE bucket = ?').bind(bucket).first<Record<string, unknown>>();
  return row ? { ...row, failures: Number(row.failures) } as unknown as LoginRateLimit : null;
}

export async function getD1LoginRateLimitsByBuckets(db: D1Database, buckets: string[]): Promise<LoginRateLimit[]> {
  if (buckets.length === 0) return [];
  const placeholders = buckets.map(() => '?').join(',');
  const result = await db.prepare(`SELECT * FROM login_rate_limits WHERE bucket IN (${placeholders})`).bind(...buckets).all<Record<string, unknown>>();
  return result.results.map(r => ({ ...r, failures: Number(r.failures) }) as unknown as LoginRateLimit);
}

export async function setD1LoginRateLimit(db: D1Database, state: LoginRateLimit): Promise<void> {
  await db.prepare(`
    INSERT INTO login_rate_limits (bucket, failures, first_failed_at, last_failed_at, locked_until)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(bucket) DO UPDATE SET failures = excluded.failures, first_failed_at = excluded.first_failed_at,
    last_failed_at = excluded.last_failed_at, locked_until = excluded.locked_until
  `).bind(state.bucket, state.failures, state.first_failed_at, state.last_failed_at, state.locked_until || null).run();
}

export async function setD1LoginRateLimits(db: D1Database, states: LoginRateLimit[]): Promise<void> {
  const batch = states.map(state =>
    db.prepare(`
      INSERT INTO login_rate_limits (bucket, failures, first_failed_at, last_failed_at, locked_until)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(bucket) DO UPDATE SET failures = excluded.failures, first_failed_at = excluded.first_failed_at,
      last_failed_at = excluded.last_failed_at, locked_until = excluded.locked_until
    `).bind(state.bucket, state.failures, state.first_failed_at, state.last_failed_at, state.locked_until || null)
  );
  await db.batch(batch);
}

export async function clearD1LoginRateLimits(db: D1Database, buckets: string[]): Promise<void> {
  if (buckets.length === 0) return;
  const placeholders = buckets.map(() => '?').join(',');
  await db.prepare(`DELETE FROM login_rate_limits WHERE bucket IN (${placeholders})`).bind(...buckets).run();
}

export async function deleteD1LoginRateLimitsBefore(db: D1Database, beforeTime: string): Promise<void> {
  await db.prepare('DELETE FROM login_rate_limits WHERE last_failed_at < ?').bind(beforeTime).run();
}

// =============================================================================
// Notifications
// =============================================================================

export async function getD1OfflineNotification(db: D1Database, client: string): Promise<OfflineNotification | null> {
  const row = await db.prepare('SELECT * FROM offline_notifications WHERE client = ?').bind(client).first<Record<string, unknown>>();
  return row ? { client: row.client as string, enable: toBool(row.enable), grace_period: Number(row.grace_period), last_notified: (row.last_notified as string) || null } : null;
}

export async function listD1OfflineNotifications(db: D1Database): Promise<OfflineNotification[]> {
  const result = await db.prepare('SELECT * FROM offline_notifications').all<Record<string, unknown>>();
  return result.results.map(r => ({ client: r.client as string, enable: toBool(r.enable), grace_period: Number(r.grace_period), last_notified: (r.last_notified as string) || null }));
}

export async function setD1OfflineNotifications(db: D1Database, items: OfflineNotificationUpdate[]): Promise<number> {
  let count = 0;
  for (const item of items) {
    const result = await db.prepare(`
      INSERT INTO offline_notifications (client, enable, grace_period) VALUES (?, ?, ?)
      ON CONFLICT(client) DO UPDATE SET enable = excluded.enable, grace_period = excluded.grace_period
    `).bind(item.client, fromBool(item.enable), item.grace_period).run();
    count += result.meta.changes;
  }
  return count;
}

export async function markD1OfflineNotificationSent(db: D1Database, client: string, time: string): Promise<void> {
  await db.prepare('UPDATE offline_notifications SET last_notified = ? WHERE client = ?').bind(time, client).run();
}

export async function getD1ExpiryNotification(db: D1Database, client: string): Promise<ExpiryNotification | null> {
  const row = await db.prepare('SELECT * FROM expiry_notifications WHERE client = ?').bind(client).first<Record<string, unknown>>();
  return row ? { client: row.client as string, enable: toBool(row.enable), advance_days: Number(row.advance_days), last_notified: (row.last_notified as string) || null } : null;
}

export async function listD1ExpiryNotifications(db: D1Database): Promise<ExpiryNotification[]> {
  const result = await db.prepare('SELECT * FROM expiry_notifications').all<Record<string, unknown>>();
  return result.results.map(r => ({ client: r.client as string, enable: toBool(r.enable), advance_days: Number(r.advance_days), last_notified: (r.last_notified as string) || null }));
}

export async function setD1ExpiryNotifications(db: D1Database, items: ExpiryNotificationUpdate[]): Promise<number> {
  let count = 0;
  for (const item of items) {
    const result = await db.prepare(`
      INSERT INTO expiry_notifications (client, enable, advance_days) VALUES (?, ?, ?)
      ON CONFLICT(client) DO UPDATE SET enable = excluded.enable, advance_days = excluded.advance_days
    `).bind(item.client, fromBool(item.enable), item.advance_days).run();
    count += result.meta.changes;
  }
  return count;
}

export async function markD1ExpiryNotificationSent(db: D1Database, client: string, time: string): Promise<void> {
  await db.prepare('UPDATE expiry_notifications SET last_notified = ? WHERE client = ?').bind(time, client).run();
}

export async function listD1LoadNotifications(db: D1Database): Promise<LoadNotification[]> {
  const result = await db.prepare('SELECT * FROM load_notifications ORDER BY id').all<Record<string, unknown>>();
  return result.results.map(r => ({
    ...r,
    clients: parseJsonField<string[]>(r.clients),
    threshold: Number(r.threshold),
    ratio: Number(r.ratio),
  }) as unknown as LoadNotification);
}

export async function getD1LoadNotification(db: D1Database, id: number): Promise<LoadNotification | null> {
  const row = await db.prepare('SELECT * FROM load_notifications WHERE id = ?').bind(id).first<Record<string, unknown>>();
  return row ? { ...row, clients: parseJsonField<string[]>(row.clients), threshold: Number(row.threshold), ratio: Number(row.ratio) } as unknown as LoadNotification : null;
}

export async function getD1LoadMetricWindowStatsForClients(db: D1Database, clients: string[], start: string, end: string, metric: LoadNotificationMetric, threshold: number): Promise<Map<string, LoadMetricWindowStats>> {
  if (clients.length === 0) return new Map();
  const placeholders = clients.map(() => '?').join(',');
  const result = await db.prepare(`SELECT client, ${metric} AS value FROM records WHERE client IN (${placeholders}) AND time >= ? AND time <= ? ORDER BY time`)
    .bind(...clients, start, end).all<{ client: string; value: number }>();

  const statsMap = new Map<string, { samples: number; exceeded: number; total: number }>();
  for (const row of result.results) {
    let stat = statsMap.get(row.client);
    if (!stat) { stat = { samples: 0, exceeded: 0, total: 0 }; statsMap.set(row.client, stat); }
    stat.samples++;
    stat.total += row.value;
    if (row.value > threshold) stat.exceeded++;
  }

  return new Map([...statsMap.entries()].map(([client, stat]) => [
    client,
    { samples: stat.samples, exceeded: stat.exceeded, avg_value: stat.samples > 0 ? stat.total / stat.samples : 0 },
  ]));
}

export async function createD1LoadNotification(db: D1Database, data: LoadNotificationInput): Promise<void> {
  await db.prepare('INSERT INTO load_notifications (name, clients, metric, threshold, ratio, interval_min) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(data.name || '', JSON.stringify(parseJsonField<string[]>(data.clients) || []), data.metric || 'cpu', Number(data.threshold || 80), Number(data.ratio || 0.8), Number(data.interval_min || 15)).run();
}

export async function updateD1LoadNotification(db: D1Database, id: number, data: LoadNotificationInput): Promise<boolean> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (key === 'id' || value === undefined) continue;
    if (key === 'clients') {
      sets.push('clients = ?');
      values.push(JSON.stringify(parseJsonField<string[]>(value) || []));
    } else {
      sets.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (sets.length === 0) return false;
  values.push(id);
  const result = await db.prepare(`UPDATE load_notifications SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
  return result.meta.changes > 0;
}

export async function deleteD1LoadNotification(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM load_notifications WHERE id = ?').bind(id).run();
}

// =============================================================================
// Website Monitors
// =============================================================================

export async function listD1DueWebsiteMonitors(db: D1Database, now: string, limit: number): Promise<WebsiteMonitor[]> {
  const result = await db.prepare(`
    SELECT * FROM website_monitors
    WHERE enabled = 1 AND status != 'paused'
    AND (last_checked_at IS NULL OR datetime(last_checked_at, '+' || interval_sec || ' seconds') <= ?)
    ORDER BY last_checked_at ASC NULLS FIRST LIMIT ?
  `).bind(now, limit).all<Record<string, unknown>>();
  return normalizeWebsiteMonitorList(result.results.map(r => ({ ...r, enabled: toBool(r.enabled), hidden: toBool(r.hidden) }) as unknown as WebsiteMonitor));
}

export async function recordD1WebsiteCheck(db: D1Database, check: WebsiteCheckInput): Promise<WebsiteMonitor | null> {
  const now = new Date().toISOString();
  const ok = check.effective_status === 'up';
  await db.prepare(`
    INSERT INTO website_checks (monitor_id, checked_at, ok, effective_status, effective_reason, status_code, raw_status_code, latency_ms, error, source_type, source_client)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(check.monitor_id, check.checked_at, fromBool(ok), check.effective_status, check.effective_reason || null, check.status_code || null, check.raw_status_code || null, check.latency_ms || null, check.error || null, check.source_type || 'worker', check.source_client || null).run();

  // Update monitor status
  if (ok) {
    await db.prepare(`
      UPDATE website_monitors SET status = 'up', last_checked_at = ?, last_success_at = ?, last_status_code = ?,
      last_raw_status_code = ?, last_latency_ms = ?, last_effective_reason = ?, last_error = NULL,
      down_since = NULL, updated_at = ?
      WHERE id = ?
    `).bind(check.checked_at, check.checked_at, check.status_code || null, check.raw_status_code || null, check.latency_ms || null, check.effective_reason || null, now, check.monitor_id).run();
  } else {
    await db.prepare(`
      UPDATE website_monitors SET status = 'down', last_checked_at = ?, last_failure_at = ?, last_status_code = ?,
      last_raw_status_code = ?, last_latency_ms = ?, last_effective_reason = ?, last_error = ?,
      down_since = COALESCE(down_since, ?), updated_at = ?
      WHERE id = ?
    `).bind(check.checked_at, check.checked_at, check.status_code || null, check.raw_status_code || null, check.latency_ms || null, check.effective_reason || null, check.error || null, check.checked_at, now, check.monitor_id).run();
  }

  return getD1WebsiteMonitor(db, check.monitor_id);
}

export async function listD1AgentWebsiteProbeTasks(db: D1Database, client: string, now: string, limit: number): Promise<WebsiteMonitor[]> {
  // Get monitors where agent_probe_mode is 'selected' and client is in the list,
  // or 'country_auto' (which we treat the same for now)
  const result = await db.prepare(`
    SELECT * FROM website_monitors
    WHERE enabled = 1 AND status != 'paused'
    AND agent_probe_mode != 'off'
    AND (last_checked_at IS NULL OR datetime(last_checked_at, '+' || interval_sec || ' seconds') <= ?)
    ORDER BY last_checked_at ASC NULLS FIRST LIMIT ?
  `).bind(now, limit).all<Record<string, unknown>>();

  // Filter in application: for 'selected' mode, check client is in agent_probe_clients
  const all = normalizeWebsiteMonitorList(result.results.map(r => ({ ...r, enabled: toBool(r.enabled), hidden: toBool(r.hidden) }) as unknown as WebsiteMonitor));
  return all.filter(m => {
    if (m.agent_probe_mode === 'country_auto') return true;
    if (m.agent_probe_mode === 'selected') return m.agent_probe_clients.includes(client);
    return false;
  });
}

export async function markD1WebsiteMonitorNotified(db: D1Database, id: number, time: string | null): Promise<boolean> {
  const result = await db.prepare('UPDATE website_monitors SET last_notified_at = ?, updated_at = ? WHERE id = ?')
    .bind(time, new Date().toISOString(), id).run();
  return result.meta.changes > 0;
}

export async function listD1WebsiteMonitors(db: D1Database): Promise<WebsiteMonitor[]> {
  const result = await db.prepare('SELECT * FROM website_monitors ORDER BY sort_order, id').all<Record<string, unknown>>();
  return normalizeWebsiteMonitorList(result.results.map(r => ({ ...r, enabled: toBool(r.enabled), hidden: toBool(r.hidden) }) as unknown as WebsiteMonitor));
}

export async function getD1WebsiteMonitor(db: D1Database, id: number): Promise<WebsiteMonitor | null> {
  const row = await db.prepare('SELECT * FROM website_monitors WHERE id = ?').bind(id).first<Record<string, unknown>>();
  return row ? normalizeWebsiteMonitor({ ...row, enabled: toBool(row.enabled), hidden: toBool(row.hidden) } as unknown as WebsiteMonitor) : null;
}

export async function listD1WebsiteChecks(db: D1Database, monitorId: number, limit: number): Promise<WebsiteCheck[]> {
  const result = await db.prepare('SELECT * FROM website_checks WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT ?').bind(monitorId, limit).all<Record<string, unknown>>();
  return result.results.map(r => ({ ...r, ok: toBool(r.ok) }) as unknown as WebsiteCheck);
}

export async function createD1WebsiteMonitor(db: D1Database, monitor: WebsiteMonitorInput): Promise<WebsiteMonitor> {
  const maxOrder = await db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM website_monitors').first<{ next_order: number }>();
  const sortOrder = monitor.sort_order ?? (maxOrder?.next_order ?? 1);
  const now = new Date().toISOString();
  const result = await db.prepare(`
    INSERT INTO website_monitors (name, url, method, expected_status_min, expected_status_max, interval_sec, timeout_sec,
      grace_period_sec, enabled, hidden, agent_probe_mode, agent_probe_clients, agent_probe_limit,
      agent_probe_status_enabled, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    monitor.name, monitor.url, monitor.method, monitor.expected_status_min, monitor.expected_status_max,
    monitor.interval_sec, monitor.timeout_sec, monitor.grace_period_sec, fromBool(monitor.enabled), fromBool(monitor.hidden),
    monitor.agent_probe_mode, JSON.stringify(monitor.agent_probe_clients || []), monitor.agent_probe_limit,
    fromBool(monitor.agent_probe_status_enabled), sortOrder, now, now,
  ).run();
  return (await getD1WebsiteMonitor(db, result.meta.last_row_id as number))!;
}

export async function updateD1WebsiteMonitorAndReturn(db: D1Database, id: number, monitor: Partial<WebsiteMonitorInput>): Promise<WebsiteMonitor | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const now = new Date().toISOString();

  for (const [key, value] of Object.entries(monitor)) {
    if (key === 'id' || value === undefined) continue;
    if (key === 'enabled' || key === 'hidden' || key === 'agent_probe_status_enabled') {
      sets.push(`${key} = ?`);
      values.push(fromBool(Boolean(value)));
    } else if (key === 'agent_probe_clients') {
      sets.push('agent_probe_clients = ?');
      values.push(JSON.stringify(value || []));
    } else {
      sets.push(`${key} = ?`);
      values.push(value);
    }
  }
  sets.push('updated_at = ?');
  values.push(now);
  if (sets.length === 1) return getD1WebsiteMonitor(db, id); // only updated_at, nothing else
  values.push(id);
  await db.prepare(`UPDATE website_monitors SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
  return getD1WebsiteMonitor(db, id);
}

export async function deleteD1WebsiteMonitor(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM website_monitors WHERE id = ?').bind(id).run();
}

export async function reorderD1WebsiteMonitors(db: D1Database, ids: number[]): Promise<number> {
  let count = 0;
  for (let i = 0; i < ids.length; i++) {
    const result = await db.prepare('UPDATE website_monitors SET sort_order = ?, updated_at = ? WHERE id = ?')
      .bind(i + 1, new Date().toISOString(), ids[i]).run();
    count += result.meta.changes;
  }
  return count;
}

export async function setD1WebsiteMonitorVisibility(db: D1Database, id: number, hidden: boolean): Promise<boolean> {
  const result = await db.prepare('UPDATE website_monitors SET hidden = ?, updated_at = ? WHERE id = ?')
    .bind(fromBool(hidden), new Date().toISOString(), id).run();
  return result.meta.changes > 0;
}

export async function setD1WebsiteMonitorEnabled(db: D1Database, id: number, enabled: boolean): Promise<boolean> {
  const result = await db.prepare('UPDATE website_monitors SET enabled = ?, updated_at = ? WHERE id = ?')
    .bind(fromBool(enabled), new Date().toISOString(), id).run();
  return result.meta.changes > 0;
}

export async function getD1PublicPingTasks(db: D1Database): Promise<PingTask[]> {
  const result = await db.prepare('SELECT * FROM ping_tasks ORDER BY sort_order, id').all<Record<string, unknown>>();
  return normalizePingTaskList(result.results.map(r => ({ ...r, clients: parseJsonField<string[]>(r.clients), all_clients: toBool(r.all_clients) }) as unknown as PingTask));
}

export async function getD1PublicWebsites(db: D1Database, _periodHours: number, checkLimit: number, includeHidden: boolean): Promise<PublicWebsiteMonitor[]> {
  let sql = 'SELECT * FROM website_monitors';
  if (!includeHidden) sql += ' WHERE hidden = 0';
  sql += ' ORDER BY sort_order, id';
  const result = await db.prepare(sql).all<Record<string, unknown>>();
  const monitors = result.results.map(r => ({ ...r, enabled: toBool(r.enabled), hidden: toBool(r.hidden) }) as unknown as WebsiteMonitor);

  const publicMonitors: PublicWebsiteMonitor[] = [];
  for (const m of monitors) {
    const checks = await listD1WebsiteChecks(db, m.id, checkLimit);
    publicMonitors.push({
      id: m.id,
      name: m.name,
      url: m.url,
      interval_sec: m.interval_sec,
      status: m.status,
      last_checked_at: m.last_checked_at,
      last_status_code: m.last_status_code,
      last_raw_status_code: m.last_raw_status_code,
      last_latency_ms: m.last_latency_ms,
      last_effective_reason: m.last_effective_reason,
      checks,
    });
  }
  return publicMonitors;
}

export async function getD1PublicWebsiteMonitorById(db: D1Database, id: number, checkLimit: number, includeHidden: boolean): Promise<PublicWebsiteMonitor | null> {
  let sql = 'SELECT * FROM website_monitors WHERE id = ?';
  if (!includeHidden) sql += ' AND hidden = 0';
  const row = await db.prepare(sql).bind(id).first<Record<string, unknown>>();
  if (!row) return null;
  const m = normalizeWebsiteMonitor({ ...row, enabled: toBool(row.enabled), hidden: toBool(row.hidden) } as unknown as WebsiteMonitor);
  const checks = await listD1WebsiteChecks(db, m.id, checkLimit);
  return {
    id: m.id,
    name: m.name,
    url: m.url,
    interval_sec: m.interval_sec,
    status: m.status,
    last_checked_at: m.last_checked_at,
    last_status_code: m.last_status_code,
    last_raw_status_code: m.last_raw_status_code,
    last_latency_ms: m.last_latency_ms,
    last_effective_reason: m.last_effective_reason,
    checks,
  };
}

// =============================================================================
// Themes
// =============================================================================

export async function listD1Themes(db: D1Database): Promise<Theme[]> {
  const result = await db.prepare('SELECT * FROM themes ORDER BY short').all<Record<string, unknown>>();
  return result.results.map(r => ({ ...r }) as unknown as Theme);
}

export async function getD1Theme(db: D1Database, short: string): Promise<Theme | null> {
  const row = await db.prepare('SELECT * FROM themes WHERE short = ?').bind(short).first<Record<string, unknown>>();
  return row ? ({ ...row }) as unknown as Theme : null;
}

export async function upsertD1Theme(db: D1Database, theme: ThemeUpsertInput, assets: ThemeAssetUpsertInput[]): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO themes (short, name, description, version, author, url, preview_path, style_path, manifest_json, config_json, custom_css, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(short) DO UPDATE SET name = excluded.name, description = excluded.description, version = excluded.version,
    author = excluded.author, url = excluded.url, preview_path = excluded.preview_path, style_path = excluded.style_path,
    manifest_json = excluded.manifest_json, config_json = excluded.config_json, custom_css = excluded.custom_css,
    updated_at = excluded.updated_at
  `).bind(theme.short, theme.name, theme.description, theme.version, theme.author, theme.url, theme.preview_path, theme.style_path, theme.manifest_json, theme.config_json, theme.custom_css, now, now).run();

  // Delete old assets and insert new ones
  await db.prepare('DELETE FROM theme_assets WHERE theme_short = ?').bind(theme.short).run();
  const batch = assets.map(a =>
    db.prepare('INSERT INTO theme_assets (theme_short, path, content_type, content_base64, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(theme.short, a.path, a.content_type, a.content_base64, a.size_bytes, now)
  );
  if (batch.length > 0) await db.batch(batch);
}

export async function updateD1ThemeSettings(db: D1Database, short: string, configJson: string, customCss: string): Promise<boolean> {
  const result = await db.prepare('UPDATE themes SET config_json = ?, custom_css = ?, updated_at = ? WHERE short = ?')
    .bind(configJson, customCss, new Date().toISOString(), short).run();
  return result.meta.changes > 0;
}

export async function deleteD1Theme(db: D1Database, short: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM themes WHERE short = ?').bind(short).run();
  return result.meta.changes > 0;
}

export async function getD1ThemeAsset(db: D1Database, short: string, path: string): Promise<ThemeAsset | null> {
  const row = await db.prepare('SELECT * FROM theme_assets WHERE theme_short = ? AND path = ?').bind(short, path).first<Record<string, unknown>>();
  return row ? ({ ...row }) as unknown as ThemeAsset : null;
}

// =============================================================================
// Audit Logs
// =============================================================================

export async function listD1AuditLogsPaged(db: D1Database, page: number, limit: number): Promise<AuditLogsPage> {
  const countRow = await db.prepare('SELECT COUNT(*) AS total FROM audit_logs').first<{ total: number }>();
  const total = countRow?.total ?? 0;
  const offset = (page - 1) * limit;
  const result = await db.prepare('SELECT * FROM audit_logs ORDER BY time DESC LIMIT ? OFFSET ?').bind(limit, offset).all<Record<string, unknown>>();
  return {
    logs: result.results.map(r => ({ ...r }) as unknown as AuditLogsPage['logs'][number]),
    total,
    has_more: offset + limit < total,
  };
}

export async function insertD1AuditLog(db: D1Database, user: string, action: string, detail: string, level = 'info'): Promise<void> {
  await db.prepare('INSERT INTO audit_logs ("user", action, detail, level) VALUES (?, ?, ?, ?)')
    .bind(user, action, redactDatabaseSecrets(detail), level).run();
}

// =============================================================================
// Cleanup
// =============================================================================

export async function deleteD1OldRecords(db: D1Database, beforeTime: string, _options: DeleteOldRowsOptions = {}): Promise<{ records: number; gpu_records: number; gpu_snapshots: number }> {
  const r1 = await db.prepare('DELETE FROM records WHERE time < ?').bind(beforeTime).run();
  const r2 = await db.prepare('DELETE FROM gpu_records WHERE time < ?').bind(beforeTime).run();
  const r3 = await db.prepare('DELETE FROM gpu_snapshots WHERE time < ?').bind(beforeTime).run();
  return { records: r1.meta.changes, gpu_records: r2.meta.changes, gpu_snapshots: r3.meta.changes };
}

export async function deleteD1OldWebsiteChecks(db: D1Database, beforeTime: string, _options: DeleteOldRowsOptions = {}): Promise<{ website_checks: number }> {
  const r = await db.prepare('DELETE FROM website_checks WHERE checked_at < ?').bind(beforeTime).run();
  return { website_checks: r.meta.changes };
}

export async function deleteD1OldPingRecords(db: D1Database, beforeTime: string, _options: DeleteOldRowsOptions = {}): Promise<{ ping_records: number; ping_snapshots: number }> {
  const r1 = await db.prepare('DELETE FROM ping_records WHERE time < ?').bind(beforeTime).run();
  const r2 = await db.prepare('DELETE FROM ping_snapshots WHERE time < ?').bind(beforeTime).run();
  return { ping_records: r1.meta.changes, ping_snapshots: r2.meta.changes };
}

export async function deleteD1OldAuditLogs(db: D1Database, beforeTime: string, _options: DeleteOldRowsOptions = {}): Promise<{ audit_logs: number }> {
  const r = await db.prepare('DELETE FROM audit_logs WHERE time < ?').bind(beforeTime).run();
  return { audit_logs: r.meta.changes };
}

export async function clearD1AllRecords(db: D1Database): Promise<ClearAllRecordsResult> {
  const r1 = await db.prepare('DELETE FROM records').run();
  const r2 = await db.prepare('DELETE FROM gpu_records').run();
  const r3 = await db.prepare('DELETE FROM gpu_snapshots').run();
  const r4 = await db.prepare('DELETE FROM ping_records').run();
  const r5 = await db.prepare('DELETE FROM ping_snapshots').run();
  const deleted = { records: r1.meta.changes, gpu_records: r2.meta.changes, gpu_snapshots: r3.meta.changes, ping_records: r4.meta.changes, ping_snapshots: r5.meta.changes };
  return { deleted, remaining: { records: 0, gpu_records: 0, gpu_snapshots: 0, ping_records: 0, ping_snapshots: 0 }, has_more: false };
}

export async function clearD1ClientRecords(db: D1Database, client: string): Promise<void> {
  await db.prepare('DELETE FROM records WHERE client = ?').bind(client).run();
  await db.prepare('DELETE FROM gpu_records WHERE client = ?').bind(client).run();
  await db.prepare('DELETE FROM gpu_snapshots WHERE client = ?').bind(client).run();
  await db.prepare('DELETE FROM ping_records WHERE client = ?').bind(client).run();
  await db.prepare('DELETE FROM ping_snapshots WHERE client = ?').bind(client).run();
}

// =============================================================================
// Storage counts
// =============================================================================

export async function getD1StorageRowCounts(db: D1Database): Promise<TableRowCounts> {
  const tables = ['records', 'gpu_records', 'gpu_snapshots', 'ping_records', 'ping_snapshots', 'audit_logs'];
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();
    counts[table] = row?.count ?? 0;
  }
  return counts as unknown as TableRowCounts;
}

export async function getD1BoundedStorageRowCounts(db: D1Database, limit: number): Promise<BoundedTableRowCounts> {
  const counts = await getD1StorageRowCounts(db);
  const capped: Record<string, boolean> = {};
  const mutable = counts as unknown as Record<string, number>;
  for (const key of Object.keys(counts)) {
    capped[key] = mutable[key] > limit;
    if (capped[key]) mutable[key] = limit;
  }
  return { counts, capped: capped as BoundedTableRowCounts['capped'], limit };
}

export async function getD1HistoryStorageRowCounts(db: D1Database): Promise<HistoryTableRowCounts> {
  const counts = await getD1StorageRowCounts(db);
  const { audit_logs: _, ...history } = counts;
  return history;
}

export async function getD1ExpiredRowCounts(db: D1Database, beforeTimes: { records: string; ping_records: string; audit_logs: string }): Promise<TableRowCounts> {
  const r1 = await db.prepare('SELECT COUNT(*) AS count FROM records WHERE time < ?').bind(beforeTimes.records).first<{ count: number }>();
  const r2 = await db.prepare('SELECT COUNT(*) AS count FROM ping_records WHERE time < ?').bind(beforeTimes.ping_records).first<{ count: number }>();
  const r3 = await db.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE time < ?').bind(beforeTimes.audit_logs).first<{ count: number }>();
  return {
    records: r1?.count ?? 0,
    gpu_records: 0,
    gpu_snapshots: 0,
    ping_records: r2?.count ?? 0,
    ping_snapshots: 0,
    audit_logs: r3?.count ?? 0,
  };
}

// =============================================================================
// Backup / Restore
// =============================================================================

export async function restoreD1BackupData(db: D1Database, backup: BackupData): Promise<void> {
  // Simple restore: upsert settings, clients, users, themes, etc.
  if (backup.settings) {
    await setD1Settings(db, backup.settings);
  }
  // Additional restore logic would go here for other entities
}
