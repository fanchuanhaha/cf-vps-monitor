export * from './types';

import type { AppDatabase } from './provider';
import * as d1 from './d1/client';
import type * as t from './types';
import type { BackupData } from '../utils/backup';
import { redactDatabaseSecrets } from '../utils/setup-diagnostics';

export type QueryDatabase = AppDatabase;

function filterSettings(settings: Record<string, string>, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.flatMap(key => key in settings ? [[key, settings[key]]] : []));
}

export async function getClient(database: QueryDatabase, uuid: string): Promise<t.Client | null> {
  return d1.getD1Client(database.db, uuid);
}

export async function clientExists(database: QueryDatabase, uuid: string): Promise<boolean> {
  return d1.d1ClientExists(database.db, uuid);
}

export async function getClientTokenMeta(database: QueryDatabase, uuid: string): Promise<t.ClientTokenMeta | null> {
  return d1.getD1ClientTokenMeta(database.db, uuid);
}

export async function getClientsByIds(database: QueryDatabase, uuids: string[]): Promise<t.Client[]> {
  return d1.getD1ClientsByIds(database.db, uuids);
}

export async function getClientByToken(database: QueryDatabase, token: string, _fresh = false): Promise<t.Client | null> {
  return d1.getD1ClientByToken(database.db, token);
}

export async function getClientIdentityByToken(database: QueryDatabase, token: string, _fresh = false): Promise<t.ClientIdentity | null> {
  return d1.getD1ClientIdentityByToken(database.db, token);
}

export async function clientTokenExists(database: QueryDatabase, token: string): Promise<boolean> {
  return d1.d1ClientTokenExists(database.db, token);
}

export async function getClientCreateConflict(database: QueryDatabase, uuid: string, token: string): Promise<'uuid' | 'token' | null> {
  return d1.getD1ClientCreateConflict(database.db, uuid, token);
}

export async function listClients(database: QueryDatabase, _fresh = false): Promise<t.Client[]> {
  return d1.getD1AdminClients(database.db);
}

export async function countClientCapacityTargets(database: QueryDatabase): Promise<t.ClientCapacityCounts> {
  return d1.getD1ClientCapacityCounts(database.db);
}

export async function listPublicClientRows(database: QueryDatabase, _fresh = false): Promise<t.PublicClientRow[]> {
  return d1.getD1PublicClients(database.db);
}

export async function getClientVisibility(database: QueryDatabase, uuid: string): Promise<t.ClientVisibility | null> {
  return d1.getD1ClientVisibility(database.db, uuid);
}

export async function listScheduledClientRows(database: QueryDatabase): Promise<t.ScheduledClientRow[]> {
  return d1.listD1ScheduledClientRows(database.db);
}

export async function getScheduledClientRowsByIds(database: QueryDatabase, uuids: string[]): Promise<t.ScheduledClientRow[]> {
  return d1.getD1ScheduledClientRowsByIds(database.db, uuids);
}

export async function listClientIds(database: QueryDatabase): Promise<string[]> {
  return d1.getD1ClientIds(database.db);
}

export async function createClient(database: QueryDatabase, client: Partial<t.Client>): Promise<t.Client> {
  return d1.createD1Client(database.db, client);
}

export async function updateClient(database: QueryDatabase, uuid: string, data: Partial<t.Client> | Record<string, unknown>): Promise<boolean> {
  return d1.updateD1Client(database.db, uuid, data);
}

export async function updateClientAndReturn(database: QueryDatabase, uuid: string, data: Partial<t.Client> | Record<string, unknown>): Promise<t.Client | null> {
  return d1.updateD1ClientAndReturn(database.db, uuid, data);
}

export async function rotateClientToken(database: QueryDatabase, uuid: string, token: string): Promise<t.Client | null> {
  return d1.rotateD1ClientToken(database.db, uuid, token);
}

export async function markClientTokenUsed(database: QueryDatabase, uuid: string, ip = ''): Promise<boolean> {
  return d1.markD1ClientTokenUsed(database.db, uuid, ip);
}

export async function deleteClient(database: QueryDatabase, uuid: string): Promise<t.DeleteClientsResult> {
  return d1.deleteD1Clients(database.db, [uuid]);
}

export async function deleteClients(database: QueryDatabase, uuids: string[]): Promise<t.DeleteClientsResult> {
  return d1.deleteD1Clients(database.db, uuids);
}

export async function updateClientsHidden(database: QueryDatabase, uuids: string[], hidden: boolean): Promise<number> {
  return d1.updateD1ClientsHidden(database.db, uuids, hidden);
}

export async function reorderClients(database: QueryDatabase, orderedUuids: string[]): Promise<number> {
  return d1.reorderD1Clients(database.db, orderedUuids);
}

export async function countUsers(database: QueryDatabase): Promise<number> {
  return d1.countD1Users(database.db);
}

export async function createUser(
  database: QueryDatabase,
  user: { uuid: string; username: string; hashedPassword: string },
): Promise<boolean> {
  return d1.createD1User(database.db, user);
}

export async function deleteUserIfMatches(
  database: QueryDatabase,
  user: { uuid: string; username: string; hashedPassword: string },
): Promise<boolean> {
  return d1.deleteD1UserIfMatches(database.db, user);
}

export async function recoverSingleAdmin(
  database: QueryDatabase,
  user: { uuid: string; username: string; hashedPassword: string },
): Promise<t.User> {
  return d1.recoverD1SingleAdmin(database.db, user);
}

export async function getUserByUsername(database: QueryDatabase, username: string): Promise<t.User | null> {
  return d1.getD1LoginUser(database.db, username);
}

export async function getUserByUuid(database: QueryDatabase, uuid: string): Promise<t.User | null> {
  return d1.getD1UserByUuid(database.db, uuid);
}

export async function updateUserUsername(database: QueryDatabase, uuid: string, username: string): Promise<void> {
  return d1.updateD1UserUsername(database.db, uuid, username);
}

export async function updateUserUsernameAndRotateSession(database: QueryDatabase, uuid: string, username: string): Promise<t.User | null> {
  return d1.updateD1UserUsernameAndRotateSession(database.db, uuid, username);
}

export async function updateUserPassword(database: QueryDatabase, uuid: string, hashedPassword: string): Promise<void> {
  return d1.updateD1UserPassword(database.db, uuid, hashedPassword);
}

export async function updateUserPasswordAndRotateSession(
  database: QueryDatabase,
  uuid: string,
  hashedPassword: string,
): Promise<t.User | null> {
  return d1.updateD1UserPasswordAndRotateSession(database.db, uuid, hashedPassword);
}

export async function rotateUserSession(database: QueryDatabase, uuid: string): Promise<t.User | null> {
  return d1.rotateD1UserSession(database.db, uuid);
}

export async function getLoginRateLimit(database: QueryDatabase, bucket: string): Promise<t.LoginRateLimit | null> {
  return d1.getD1LoginRateLimit(database.db, bucket);
}

export async function getLoginRateLimitsByBuckets(database: QueryDatabase, buckets: string[]): Promise<Map<string, t.LoginRateLimit>> {
  const rows = await d1.getD1LoginRateLimitsByBuckets(database.db, buckets);
  return new Map(rows.map(row => [row.bucket, row]));
}

export async function setLoginRateLimit(database: QueryDatabase, state: t.LoginRateLimit): Promise<void> {
  return d1.setD1LoginRateLimit(database.db, state);
}

export async function setLoginRateLimits(database: QueryDatabase, states: t.LoginRateLimit[]): Promise<void> {
  return d1.setD1LoginRateLimits(database.db, states);
}

export async function clearLoginRateLimit(database: QueryDatabase, bucket: string): Promise<void> {
  return d1.clearD1LoginRateLimits(database.db, [bucket]);
}

export async function clearLoginRateLimits(database: QueryDatabase, buckets: string[]): Promise<void> {
  return d1.clearD1LoginRateLimits(database.db, buckets);
}

export async function deleteLoginRateLimitsBefore(database: QueryDatabase, beforeTime: string): Promise<void> {
  return d1.deleteD1LoginRateLimitsBefore(database.db, beforeTime);
}

export async function getSetting(database: QueryDatabase, key: string): Promise<string | null> {
  return (await d1.getD1PublicSettings(database.db))[key] ?? null;
}

export async function getSettingsByKeys(database: QueryDatabase, keys: string[], _fresh = false): Promise<Record<string, string>> {
  return filterSettings(await d1.getD1PublicSettings(database.db), keys);
}

export async function getRawSettingsByKeys(database: QueryDatabase, keys: string[]): Promise<Record<string, string>> {
  return filterSettings(await d1.getD1PublicSettings(database.db), keys);
}

export async function setSetting(database: QueryDatabase, key: string, value: string): Promise<void> {
  return d1.setD1Settings(database.db, { [key]: value });
}

export async function setSettings(database: QueryDatabase, settings: Record<string, string>): Promise<void> {
  return d1.setD1Settings(database.db, settings);
}

export async function getAllSettings(database: QueryDatabase, _fresh = false): Promise<Record<string, string>> {
  return d1.getD1PublicSettings(database.db);
}

export async function listThemes(database: QueryDatabase): Promise<t.Theme[]> {
  return d1.listD1Themes(database.db);
}

export async function getTheme(database: QueryDatabase, short: string): Promise<t.Theme | null> {
  return d1.getD1Theme(database.db, short);
}

export async function upsertTheme(
  database: QueryDatabase,
  theme: t.ThemeUpsertInput,
  assets: t.ThemeAssetUpsertInput[],
): Promise<void> {
  return d1.upsertD1Theme(database.db, theme, assets);
}

export async function updateThemeSettings(
  database: QueryDatabase,
  short: string,
  configJson: string,
  customCss: string,
): Promise<boolean> {
  return d1.updateD1ThemeSettings(database.db, short, configJson, customCss);
}

export async function deleteTheme(database: QueryDatabase, short: string): Promise<boolean> {
  return d1.deleteD1Theme(database.db, short);
}

export async function getThemeAsset(database: QueryDatabase, short: string, path: string): Promise<t.ThemeAsset | null> {
  return d1.getD1ThemeAsset(database.db, short, path);
}

export async function getPingTask(database: QueryDatabase, id: number): Promise<t.PingTask | null> {
  return d1.getD1PingTask(database.db, id);
}

export async function listPingTasks(database: QueryDatabase, _fresh = false): Promise<t.PingTask[]> {
  return d1.getD1PublicPingTasks(database.db);
}

export async function listPingTaskEstimateRows(database: QueryDatabase): Promise<t.PingTaskEstimateRow[]> {
  return d1.getD1PingTaskEstimateRows(database.db);
}

export async function createPingTask(database: QueryDatabase, task: t.PingTask): Promise<t.PingTask> {
  return d1.createD1PingTask(database.db, task);
}

export async function updatePingTaskAndReturn(database: QueryDatabase, id: number, task: Partial<t.PingTask>): Promise<t.PingTask | null> {
  return d1.updateD1PingTaskAndReturn(database.db, id, task);
}

export async function reorderPingTasks(database: QueryDatabase, orderedIds: number[]): Promise<number> {
  return d1.reorderD1PingTasks(database.db, orderedIds);
}

export async function deletePingTask(database: QueryDatabase, id: number): Promise<t.PingTask | null> {
  return d1.deleteD1PingTask(database.db, id);
}

export async function getWebsiteMonitor(database: QueryDatabase, id: number): Promise<t.WebsiteMonitor | null> {
  return d1.getD1WebsiteMonitor(database.db, id);
}

export async function listWebsiteMonitors(database: QueryDatabase, _fresh = false): Promise<t.WebsiteMonitor[]> {
  return d1.listD1WebsiteMonitors(database.db);
}

export async function listPublicWebsiteMonitors(database: QueryDatabase, checkLimit: number = 60, _fresh = false, periodHours = 24, includeHidden = false): Promise<t.PublicWebsiteMonitor[]> {
  return d1.getD1PublicWebsites(database.db, periodHours, checkLimit, includeHidden);
}

export async function getPublicWebsiteMonitorById(database: QueryDatabase, id: number, checkLimit: number = 120, includeHidden = false): Promise<t.PublicWebsiteMonitor | null> {
  return d1.getD1PublicWebsiteMonitorById(database.db, id, checkLimit, includeHidden);
}

export async function createWebsiteMonitor(database: QueryDatabase, monitor: t.WebsiteMonitorInput): Promise<t.WebsiteMonitor> {
  return d1.createD1WebsiteMonitor(database.db, monitor);
}

export async function updateWebsiteMonitor(database: QueryDatabase, id: number, monitor: Partial<t.WebsiteMonitorInput>): Promise<boolean> {
  return (await d1.updateD1WebsiteMonitorAndReturn(database.db, id, monitor)) !== null;
}

export async function updateWebsiteMonitorAndReturn(database: QueryDatabase, id: number, monitor: Partial<t.WebsiteMonitorInput>): Promise<t.WebsiteMonitor | null> {
  return d1.updateD1WebsiteMonitorAndReturn(database.db, id, monitor);
}

export async function deleteWebsiteMonitor(database: QueryDatabase, id: number): Promise<void> {
  return d1.deleteD1WebsiteMonitor(database.db, id);
}

export async function reorderWebsiteMonitors(database: QueryDatabase, orderedIds: number[]): Promise<number> {
  return d1.reorderD1WebsiteMonitors(database.db, orderedIds);
}

export async function setWebsiteMonitorVisibility(database: QueryDatabase, id: number, hidden: boolean): Promise<boolean> {
  return d1.setD1WebsiteMonitorVisibility(database.db, id, hidden);
}

export async function setWebsiteMonitorEnabled(database: QueryDatabase, id: number, enabled: boolean): Promise<boolean> {
  return d1.setD1WebsiteMonitorEnabled(database.db, id, enabled);
}

export async function listDueWebsiteMonitors(database: QueryDatabase, now: string, limit: number = 50): Promise<t.WebsiteMonitor[]> {
  return d1.listD1DueWebsiteMonitors(database.db, now, limit);
}

export async function recordWebsiteCheck(database: QueryDatabase, check: t.WebsiteCheckInput): Promise<t.WebsiteMonitor | null> {
  return d1.recordD1WebsiteCheck(database.db, check);
}

export async function listAgentWebsiteProbeTasks(
  database: QueryDatabase,
  client: string,
  now: string,
  limit: number = 20,
): Promise<t.WebsiteMonitor[]> {
  return d1.listD1AgentWebsiteProbeTasks(database.db, client, now, limit);
}

export async function listWebsiteChecks(database: QueryDatabase, monitorId: number, limit: number = 60): Promise<t.WebsiteCheck[]> {
  return d1.listD1WebsiteChecks(database.db, monitorId, limit);
}

export async function markWebsiteMonitorNotified(database: QueryDatabase, id: number, time: string | null): Promise<boolean> {
  return d1.markD1WebsiteMonitorNotified(database.db, id, time);
}

export async function insertRecord(database: QueryDatabase, record: t.MonitorRecord): Promise<void> {
  return d1.insertD1MonitorRecord(database.db, record);
}

export async function getRecentRecords(database: QueryDatabase, client: string, limit: number = 30): Promise<t.MonitorRecord[]> {
  return d1.getD1RecentRecords(database.db, client, limit);
}

export async function getRecordsByTimeRange(database: QueryDatabase, client: string, start: string, end: string): Promise<t.MonitorRecord[]> {
  return d1.getD1RecordsByTimeRange(database.db, client, start, end);
}

export async function getRecordsByTimeRangeLimited(
  database: QueryDatabase,
  client: string,
  start: string,
  end: string,
  limit: number,
): Promise<t.MonitorRecord[]> {
  return d1.getD1RecordsByTimeRangeLimited(database.db, client, start, end, limit);
}

export async function getRecordsByTimeRangePaged(
  database: QueryDatabase,
  client: string,
  start: string,
  end: string,
  page: number = 1,
  limit: number = 100,
): Promise<t.PagedResult<t.MonitorRecord>> {
  return d1.getD1RecordsByTimeRangePaged(database.db, client, start, end, page, limit);
}

export async function getRecordsByTimeRangeCursor(
  database: QueryDatabase,
  client: string,
  start: string,
  end: string,
  cursor: string | undefined,
  limit: number = 100,
): Promise<t.PagedResult<t.MonitorRecord>> {
  return d1.getD1RecordsByTimeRangeCursor(database.db, client, start, end, cursor, limit);
}

export async function getLatestRecordTimes(database: QueryDatabase): Promise<Array<{ client: string; last_time: string }>> {
  return d1.getD1LatestRecordTimes(database.db);
}

export async function getLatestRecordTimesForClients(
  database: QueryDatabase,
  clients: string[],
): Promise<Array<{ client: string; last_time: string }>> {
  return d1.getD1LatestRecordTimesForClients(database.db, clients);
}

export async function getLatestRecords(database: QueryDatabase): Promise<t.MonitorRecord[]> {
  return d1.getD1LatestRecords(database.db);
}

export async function getGPURecords(database: QueryDatabase, client: string, start?: string, end?: string, limit: number = 100): Promise<t.GPUHistoryRecord[]> {
  return d1.getD1GpuRecords(database.db, client, start, end, limit);
}

export async function getGPURecordsPaged(
  database: QueryDatabase,
  client: string,
  start?: string,
  end?: string,
  page: number = 1,
  limit: number = 100,
): Promise<t.PagedResult<t.GPUHistoryRecord>> {
  return d1.getD1GpuRecordsPaged(database.db, client, start, end, page, limit);
}

export async function getGPURecordsCursor(
  database: QueryDatabase,
  client: string,
  start: string | undefined,
  end: string | undefined,
  cursor: string | undefined,
  limit: number = 100,
): Promise<t.PagedResult<t.GPUHistoryRecord>> {
  return d1.getD1GpuRecordsCursor(database.db, client, start, end, cursor, limit);
}

export async function insertGPURecords(database: QueryDatabase, client: string, time: string, gpus: t.GPUInfo[]): Promise<void> {
  return d1.insertD1GpuRecords(database.db, client, time, gpus);
}

export async function deleteOldRecords(
  database: QueryDatabase,
  beforeTime: string,
  options: t.DeleteOldRowsOptions = {},
): Promise<{ records: number; gpu_records: number; gpu_snapshots: number }> {
  return d1.deleteD1OldRecords(database.db, beforeTime, options);
}

export async function deleteOldWebsiteChecks(
  database: QueryDatabase,
  beforeTime: string,
  options: t.DeleteOldRowsOptions = {},
): Promise<{ website_checks: number }> {
  return d1.deleteD1OldWebsiteChecks(database.db, beforeTime, options);
}

export async function deleteOldPingRecords(
  database: QueryDatabase,
  beforeTime: string,
  options: t.DeleteOldRowsOptions = {},
): Promise<{ ping_records: number; ping_snapshots: number }> {
  return d1.deleteD1OldPingRecords(database.db, beforeTime, options);
}

export async function clearAllRecords(
  database: QueryDatabase,
): Promise<t.ClearAllRecordsResult> {
  return d1.clearD1AllRecords(database.db);
}

export async function clearClientRecords(database: QueryDatabase, client: string): Promise<void> {
  return d1.clearD1ClientRecords(database.db, client);
}

export async function insertPingSnapshot(database: QueryDatabase, client: string, time: string, results: t.PingSnapshotInput[]): Promise<void> {
  return d1.insertD1PingSnapshot(database.db, client, time, results);
}

export async function getPingRecords(database: QueryDatabase, client: string, taskId: number, limit: number = 120): Promise<t.PingHistoryRecord[]> {
  return d1.getD1PingRecords(database.db, client, taskId, limit);
}

export async function getPingRecordsForTasks(
  database: QueryDatabase,
  client: string,
  taskIds: number[] | t.PingTaskHistoryRequest[],
  limit: number = 120,
  _baseIntervalSec?: number,
  cursor?: string,
): Promise<Record<string, t.PingHistoryRecord[]>> {
  return d1.getD1PingRecordsForTasks(database.db, client, taskIds, limit, cursor);
}

export async function getPingRecordsPaged(
  database: QueryDatabase,
  client: string,
  taskId: number,
  page: number = 1,
  limit: number = 120,
): Promise<t.PagedResult<t.PingHistoryRecord>> {
  return d1.getD1PingRecordsPaged(database.db, client, taskId, page, limit);
}

export async function getPingRecordsCursor(
  database: QueryDatabase,
  client: string,
  taskId: number,
  cursor: string | undefined,
  limit: number = 120,
): Promise<t.PagedResult<t.PingHistoryRecord>> {
  return d1.getD1PingRecordsCursor(database.db, client, taskId, cursor, limit);
}

export async function getLoadMetricWindowStats(
  database: QueryDatabase,
  client: string,
  start: string,
  end: string,
  metric: t.LoadNotificationMetric,
  threshold: number,
): Promise<t.LoadMetricWindowStats> {
  const stats = await d1.getD1LoadMetricWindowStatsForClients(database.db, [client], start, end, metric, threshold);
  return stats.get(client) || { samples: 0, exceeded: 0, avg_value: 0 };
}

export async function getLoadMetricWindowStatsForClients(
  database: QueryDatabase,
  clients: string[],
  start: string,
  end: string,
  metric: t.LoadNotificationMetric,
  threshold: number,
): Promise<Map<string, t.LoadMetricWindowStats>> {
  return d1.getD1LoadMetricWindowStatsForClients(database.db, clients, start, end, metric, threshold);
}

export async function deleteOldAuditLogs(
  database: QueryDatabase,
  beforeTime: string,
  options: t.DeleteOldRowsOptions = {},
): Promise<{ audit_logs: number }> {
  return d1.deleteD1OldAuditLogs(database.db, beforeTime, options);
}

export async function getStorageRowCounts(database: QueryDatabase): Promise<t.TableRowCounts> {
  return d1.getD1StorageRowCounts(database.db);
}

export async function getBoundedStorageRowCounts(
  database: QueryDatabase,
  limit: number,
): Promise<t.BoundedTableRowCounts> {
  return d1.getD1BoundedStorageRowCounts(database.db, limit);
}

export async function getHistoryStorageRowCounts(database: QueryDatabase): Promise<t.HistoryTableRowCounts> {
  return d1.getD1HistoryStorageRowCounts(database.db);
}

export async function getExpiredRowCounts(
  database: QueryDatabase,
  beforeTimes: { records: string; ping_records: string; audit_logs: string },
): Promise<t.TableRowCounts> {
  return d1.getD1ExpiredRowCounts(database.db, beforeTimes);
}

export async function getOfflineNotification(database: QueryDatabase, client: string, _fresh = false): Promise<t.OfflineNotification | null> {
  return d1.getD1OfflineNotification(database.db, client);
}

export async function listOfflineNotifications(database: QueryDatabase, _fresh = false): Promise<t.OfflineNotification[]> {
  return d1.listD1OfflineNotifications(database.db);
}

export async function setOfflineNotification(database: QueryDatabase, client: string, enable: boolean, gracePeriod: number): Promise<boolean> {
  return (await d1.setD1OfflineNotifications(database.db, [{ client, enable, grace_period: gracePeriod }])) > 0;
}

export async function setOfflineNotifications(database: QueryDatabase, items: t.OfflineNotificationUpdate[]): Promise<number> {
  return d1.setD1OfflineNotifications(database.db, items);
}

export async function markOfflineNotificationSent(database: QueryDatabase, client: string, time: string): Promise<void> {
  return d1.markD1OfflineNotificationSent(database.db, client, time);
}

export async function getExpiryNotification(database: QueryDatabase, client: string, _fresh = false): Promise<t.ExpiryNotification | null> {
  return d1.getD1ExpiryNotification(database.db, client);
}

export async function listExpiryNotifications(database: QueryDatabase, _fresh = false): Promise<t.ExpiryNotification[]> {
  return d1.listD1ExpiryNotifications(database.db);
}

export async function setExpiryNotification(database: QueryDatabase, client: string, enable: boolean, advanceDays: number): Promise<boolean> {
  return (await d1.setD1ExpiryNotifications(database.db, [{ client, enable, advance_days: advanceDays }])) > 0;
}

export async function setExpiryNotifications(database: QueryDatabase, items: t.ExpiryNotificationUpdate[]): Promise<number> {
  return d1.setD1ExpiryNotifications(database.db, items);
}

export async function markExpiryNotificationSent(database: QueryDatabase, client: string, time: string): Promise<void> {
  return d1.markD1ExpiryNotificationSent(database.db, client, time);
}

export async function listLoadNotifications(database: QueryDatabase, _fresh = false): Promise<t.LoadNotification[]> {
  return d1.listD1LoadNotifications(database.db);
}

export async function getLoadNotification(database: QueryDatabase, id: number, _fresh = false): Promise<t.LoadNotification | null> {
  return d1.getD1LoadNotification(database.db, id);
}

export async function createLoadNotification(database: QueryDatabase, data: t.LoadNotificationInput): Promise<void> {
  return d1.createD1LoadNotification(database.db, data);
}

export async function updateLoadNotification(database: QueryDatabase, id: number, data: t.LoadNotificationInput): Promise<boolean> {
  return d1.updateD1LoadNotification(database.db, id, data);
}

export async function deleteLoadNotification(database: QueryDatabase, id: number): Promise<void> {
  return d1.deleteD1LoadNotification(database.db, id);
}

export async function pruneClientReferences(database: QueryDatabase, uuid: string): Promise<t.ClientReferenceCleanupResult> {
  return d1.pruneD1ClientReferences(database.db, uuid);
}

export async function pruneClientReferencesForClients(database: QueryDatabase, uuids: string[]): Promise<t.ClientReferenceCleanupResult> {
  return d1.pruneD1ClientReferencesForClients(database.db, uuids);
}

export async function cleanupOrphanClientData(database: QueryDatabase): Promise<t.OrphanClientDataCleanupResult> {
  return d1.cleanupD1OrphanClientData(database.db);
}

export async function listAuditLogsPaged(
  database: QueryDatabase,
  page: number = 1,
  limit: number = 50,
): Promise<t.AuditLogsPage> {
  return d1.listD1AuditLogsPaged(database.db, page, limit);
}

export async function restoreBackupData(database: QueryDatabase, backup: BackupData): Promise<void> {
  return d1.restoreD1BackupData(database.db, backup);
}

export async function insertAuditLog(
  database: QueryDatabase,
  user: string,
  action: string,
  detail: string,
  level = 'info',
): Promise<void> {
  return d1.insertD1AuditLog(database.db, user, action, redactDatabaseSecrets(detail), level);
}
