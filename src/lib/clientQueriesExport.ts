import * as XLSX from 'xlsx';
import { db } from './db';

export async function exportClientQueriesToExcel(userId: string, isAdmin: boolean) {
  let queries;
  
  if (isAdmin) {
    queries = await db.client_queries.toArray();
  } else {
    // Usually reps will only see queries assigned to them, or queries related to their leads.
    // For this implementation, we export those assigned to the current user.
    queries = await db.client_queries.where('assigned_to').equals(userId).toArray();
  }

  const exportData = queries.map(q => ({
    'Query ID': q.query_id,
    'Lead ID': q.lead_id,
    'Client Problem': q.client_problem,
    'Problem Status': q.problem_status,
    'Assigned To': q.assigned_to,
    'Created At': q.created_at ? new Date(q.created_at).toISOString().slice(0, 16).replace('T', ' ') : '',
    'Resolved At': q.resolved_at ? new Date(q.resolved_at).toISOString().slice(0, 16).replace('T', ' ') : '',
    'Resolution Notes': q.resolution_notes || '',
    'Resolved By': q.resolved_by || ''
  }));

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Client Queries');

  const now = new Date();
  const dateStr = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const fileName = `ClientQueries_Export_${dateStr}.xlsx`;
  XLSX.writeFile(workbook, fileName);
}
