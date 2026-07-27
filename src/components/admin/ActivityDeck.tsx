import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { PageHeader } from "@/components/ui/PageHeader";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { Calendar, User, PhoneCall, CheckSquare, Database } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";


export function ActivityDeck() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [selectedUserId, setSelectedUserId] = useState<string>("all");
  const [users, setUsers] = useState<any[]>([]);
  const [activities, setActivities] = useState<{
    user: any;
    calls: any[];
    tasks: any[];
    mappings: any[];
  }[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchUsers();
  }, []);

  useEffect(() => {
    fetchActivity();
  }, [selectedDate, selectedUserId, users]);

  async function fetchUsers() {
    try {
      const { data, error } = await supabase.from("users").select("*").order("name");
      if (data) setUsers(data);
    } catch (err) {
      console.error("Error fetching users", err);
    }
  }

  async function fetchActivity() {
    if (users.length === 0) return;
    setIsLoading(true);
    try {
      // selectedDate is YYYY-MM-DD
      const [year, month, day] = selectedDate.split('-').map(Number);
      const localStart = new Date(year, month - 1, day, 0, 0, 0);
      const localEnd = new Date(year, month - 1, day, 23, 59, 59, 999);
      const start = localStart.toISOString();
      const end = localEnd.toISOString();

      let callsQuery = supabase.from("call_logs").select("*").gte("created_at", start).lte("created_at", end);
      let tasksQuery = supabase.from("tasks").select("*").gte("created_at", start).lte("created_at", end);
      let mappingsQuery = supabase.from("mapping_requests").select("*").gte("created_at", start).lte("created_at", end);

      if (selectedUserId !== "all") {
        callsQuery = callsQuery.eq("created_by", selectedUserId);
        tasksQuery = tasksQuery.eq("assigned_to", selectedUserId);
        mappingsQuery = mappingsQuery.eq("created_by", selectedUserId);
      }

      const [callsRes, tasksRes, mappingsRes] = await Promise.all([
        callsQuery,
        tasksQuery,
        mappingsQuery
      ]);

      const calls = callsRes.data || [];
      const tasks = tasksRes.data || [];
      const mappings = mappingsRes.data || [];

      // Group by user
      const grouped = new Map<string, any>();
      const ensureUser = (userId: string) => {
        if (!grouped.has(userId)) {
          const u = users.find(u => u.user_id === userId);
          if (u) {
            grouped.set(userId, { user: u, calls: [], tasks: [], mappings: [] });
          }
        }
      };

      calls.forEach(c => { ensureUser(c.created_by); grouped.get(c.created_by)?.calls.push(c); });
      tasks.forEach(t => { ensureUser(t.assigned_to); grouped.get(t.assigned_to)?.tasks.push(t); });
      mappings.forEach(m => { ensureUser(m.created_by); grouped.get(m.created_by)?.mappings.push(m); });

      // also add the selected user even if 0 activity
      if (selectedUserId !== "all") {
        ensureUser(selectedUserId);
      }

      setActivities(Array.from(grouped.values()));
    } catch (err) {
      console.error("Error fetching activity", err);
    } finally {
      setIsLoading(false);
    }
  }

  const renderIdentity = (u: any) => {
    return `${u.name} (@${u.email}) - ${u.phone || "N/A"}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Day-Wise Activity Deck" 
        description="Monitor field activities, calls, and tasks globally across all users." 
      />

      <Card className="p-4 flex flex-col sm:flex-row gap-4 items-end bg-[var(--surface-primary)] border-[var(--border-subtle)]">
        <div className="flex-1 w-full">
          <Input 
            type="date" 
            label="Select Date" 
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        </div>
        <div className="flex-1 w-full space-y-1">
          <label className="text-[12px] font-semibold text-[var(--text-secondary)]">Filter by User</label>
          <select 
            value={selectedUserId} 
            onChange={(e) => setSelectedUserId(e.target.value)}
            className="w-full h-10 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-primary)] px-3 text-[14px]"
          >
            <option value="all">Global (All Users)</option>
            {users.map(u => (
              <option key={u.user_id} value={u.user_id}>{renderIdentity(u)}</option>
            ))}
          </select>
        </div>
      </Card>

      {isLoading ? (
        <div className="flex justify-center p-12"><div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--brand-600)] border-t-transparent" /></div>
      ) : activities.length === 0 ? (
        <EmptyState 
          icon={<Calendar />} 
          title="No Activity" 
          description={`No activity recorded on ${selectedDate} for the selected criteria.`} 
        />
      ) : (
        <div className="space-y-8">
          {activities.map(group => (
            <div key={group.user.user_id} className="space-y-4">
              <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-2">
                <User className="text-[var(--brand-600)]" size={18} />
                <h3 className="text-[16px] font-semibold text-[var(--text-primary)]">
                  {renderIdentity(group.user)}
                </h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="p-4 bg-[var(--surface-secondary)] border-[var(--border-subtle)]">
                  <div className="flex items-center gap-2 mb-3">
                    <PhoneCall size={16} className="text-blue-500" />
                    <h4 className="font-semibold text-[14px]">Calls ({group.calls.length})</h4>
                  </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {group.calls.length === 0 ? <p className="text-[12px] text-[var(--text-secondary)]">No calls.</p> : group.calls.map(c => (
                      <div key={c.id} className="p-2 rounded bg-[var(--surface-primary)] border border-[var(--border-subtle)] text-[12px]">
                        <div className="font-medium">{c.client_name}</div>
                        <div className="text-[var(--text-secondary)]">{c.purpose}</div>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card className="p-4 bg-[var(--surface-secondary)] border-[var(--border-subtle)]">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckSquare size={16} className="text-green-500" />
                    <h4 className="font-semibold text-[14px]">Tasks ({group.tasks.length})</h4>
                  </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {group.tasks.length === 0 ? <p className="text-[12px] text-[var(--text-secondary)]">No tasks.</p> : group.tasks.map(t => (
                      <div key={t.id} className="p-2 rounded bg-[var(--surface-primary)] border border-[var(--border-subtle)] text-[12px]">
                        <div className="font-medium">{t.title}</div>
                        <div className="text-[var(--text-secondary)]">Status: {t.status}</div>
                        {t.status === "completed" && (
                          <div className="mt-2 flex justify-end">
                            <Button size="sm" variant="primary" disabled>Done</Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>

                <Card className="p-4 bg-[var(--surface-secondary)] border-[var(--border-subtle)]">
                  <div className="flex items-center gap-2 mb-3">
                    <Database size={16} className="text-purple-500" />
                    <h4 className="font-semibold text-[14px]">Mappings ({group.mappings.length})</h4>
                  </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {group.mappings.length === 0 ? <p className="text-[12px] text-[var(--text-secondary)]">No mappings.</p> : group.mappings.map(m => (
                      <div key={m.id} className="p-2 rounded bg-[var(--surface-primary)] border border-[var(--border-subtle)] text-[12px]">
                        <div className="font-medium">{m.mapped_entity_name}</div>
                        <div className="text-[var(--text-secondary)]">{m.mapping_type}</div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
