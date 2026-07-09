import React from "react";
import { Clock, RefreshCw } from "lucide-react";

export interface QueueItem {
  id: string;
  primaryNode: React.ReactNode;
  statusText: string;
  statusColorClasses: string; // e.g., "bg-emerald-50 text-emerald-600 border-emerald-200"
  timestamp: string;
  actions?: React.ReactNode;
}

interface QueueListProps {
  title: string;
  icon?: React.ReactNode;
  items: QueueItem[];
  emptyMessage?: string;
  onRefresh?: () => void;
}

export function QueueList({ title, icon = <Clock size={16} className="text-brand-secondary" />, items, emptyMessage = "No items found.", onRefresh }: QueueListProps) {
  return (
    <div className="lg:col-span-3 bg-white rounded-3xl border border-slate-100 shadow-sm p-6 space-y-4 flex flex-col h-full max-h-[650px]">
      <div className="flex items-center justify-between shrink-0">
        <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
          {icon} {title}
        </h3>
        {onRefresh && (
          <button onClick={onRefresh} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 cursor-pointer transition-colors" title="Refresh">
            <RefreshCw size={14} />
          </button>
        )}
      </div>

      <div className="space-y-3 overflow-y-auto pr-1 flex-1 pb-4">
        {items.length === 0 && (
          <p className="text-xs italic text-slate-400 text-center py-10 font-semibold">{emptyMessage}</p>
        )}
        {items.map(item => (
          <div
            key={item.id}
            className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3 hover:border-slate-200 transition-all"
          >
            <div className="flex justify-between items-start gap-2">
              <div className="flex-1 min-w-0">
                {item.primaryNode}
              </div>
              <span className={`shrink-0 text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${item.statusColorClasses}`}>
                {item.statusText}
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold border-t border-slate-200/50 pt-2">
              <span>{item.timestamp}</span>
              {item.actions && <div className="flex items-center gap-2">{item.actions}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
