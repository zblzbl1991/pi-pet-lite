import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  CheckCircle,
  XCircle,
  ArrowLeft,
  Activity,
  Clock,
  Hash,
  User,
} from 'lucide-react';
import type { TraceRow, Trace, Span } from '../../shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

function formatDuration(startMs: number, endMs: number | null): string {
  if (endMs == null) return '...';
  const seconds = (endMs - startMs) / 1000;
  if (seconds < 0.001) return '<0.0s';
  return `${seconds.toFixed(1)}s`;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return formatTime(ts);
}

function truncateId(id: string, len = 8): string {
  return id.length > len ? `${id.slice(0, len)}...` : id;
}

/** Span name to waterfall bar color */
function spanColor(name: string): string {
  if (name === 'llm.call') return 'var(--brand)';
  if (name === 'tool.execute') return 'var(--success)';
  return 'var(--text-tertiary)';
}

// ---------------------------------------------------------------------------
// Style constants
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  header: {
    fontSize: 'var(--text-lg)',
    fontWeight: 'var(--font-semibold)',
    marginBottom: 'var(--space-5)',
    color: 'var(--text-primary)',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
  },
  filterBar: {
    display: 'flex',
    gap: 'var(--space-3)',
    marginBottom: 'var(--space-4)',
    alignItems: 'center',
  },
  filterSelect: {
    padding: 'var(--space-2) var(--space-3)',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text-primary)',
    fontSize: 'var(--text-sm)',
    fontFamily: 'inherit',
    outline: 'none',
    cursor: 'pointer',
    appearance: 'none' as const,
    WebkitAppearance: 'none' as const,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%23aaa' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right var(--space-2) center',
    paddingRight: 'var(--space-6)',
    minWidth: 80,
  },
  filterLabel: {
    fontSize: 'var(--text-xs)',
    color: 'var(--text-tertiary)',
  },
  listContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-1)',
    maxHeight: 'calc(100vh - 220px)',
    overflowY: 'auto',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    padding: 'var(--space-2) var(--space-3)',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    transition: 'background var(--duration-fast)',
  },
  badge: {
    fontSize: 'var(--text-xs)',
    padding: '1px 6px',
    borderRadius: 'var(--radius-pill)',
    fontWeight: 'var(--font-medium)' as const,
  },
  emptyState: {
    padding: 'var(--space-6)',
    textAlign: 'center' as const,
    background: 'var(--bg-elevated)',
    borderRadius: 'var(--radius-nav)',
    border: '1px solid var(--border-subtle)',
    color: 'var(--text-tertiary)',
    fontSize: 'var(--text-sm)',
  },
  detailHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    marginBottom: 'var(--space-4)',
  },
  backBtn: {
    background: 'none',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    padding: 'var(--space-2)',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-1)',
    fontSize: 'var(--text-sm)',
    fontFamily: 'inherit',
    transition: 'all var(--duration-fast)',
  },
  waterfallContainer: {
    background: 'var(--bg-elevated)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--border-subtle)',
    padding: 'var(--space-4)',
    marginBottom: 'var(--space-4)',
    overflowX: 'auto' as const,
  },
  spanDetailContainer: {
    background: 'var(--bg-elevated)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--border-subtle)',
    padding: 'var(--space-4)',
  },
  jsonBlock: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-sm)',
    color: 'var(--text-secondary)',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
    margin: 0,
  },
};

// ---------------------------------------------------------------------------
// List Page
// ---------------------------------------------------------------------------

function TraceListPage({
  onSelect,
}: {
  onSelect: (traceId: string) => void;
}) {
  const [traces, setTraces] = useState<TraceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [petFilter, setPetFilter] = useState<string>('');
  const [petIds, setPetIds] = useState<string[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const PAGE_SIZE = 30;

  // Build unique pet IDs from loaded traces
  useEffect(() => {
    const ids = new Set<string>();
    traces.forEach((t) => {
      if (t.pet_id) ids.add(t.pet_id);
    });
    setPetIds(Array.from(ids).sort());
  }, [traces]);

  const loadTraces = useCallback(async (offset: number, append = false) => {
    if (!window.settingsAPI?.traceList) return;
    try {
      const opts: { offset: number; limit: number; status?: string; petId?: string } = {
        offset,
        limit: PAGE_SIZE,
      };
      if (statusFilter) opts.status = statusFilter;
      if (petFilter) opts.petId = petFilter;
      const result = await window.settingsAPI.traceList(opts);
      if (append) {
        setTraces((prev) => {
          const existingIds = new Set(prev.map((t) => t.id));
          const newTraces = result.traces.filter((t) => !existingIds.has(t.id));
          return [...prev, ...newTraces];
        });
      } else {
        setTraces(result.traces);
      }
      setTotal(result.total);
    } catch {
      // ignore
    }
    setHasLoaded(true);
  }, [statusFilter, petFilter]);

  // Initial load + filter changes
  useEffect(() => {
    setTraces([]);
    setTotal(0);
    setHasLoaded(false);
    loadTraces(0, false);
  }, [loadTraces]);

  // Subscribe to trace:completed
  useEffect(() => {
    if (!window.settingsAPI?.onTraceCompleted) return;
    const unsubscribe = window.settingsAPI.onTraceCompleted(() => {
      // Reload first page to get the new trace
      loadTraces(0, false);
    });
    return unsubscribe;
  }, [loadTraces]);

  // Infinite scroll
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) {
      if (traces.length < total) {
        loadTraces(traces.length, true);
      }
    }
  }, [traces.length, total, loadTraces]);

  if (!hasLoaded) {
    return (
      <div style={{ color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 'var(--space-10)' }}>
        Loading...
      </div>
    );
  }

  return (
    <>
      <div style={styles.header}>
        <Activity size={18} strokeWidth={1.5} /> Traces
      </div>

      {/* Filter bar */}
      <div style={styles.filterBar}>
        <div>
          <div style={styles.filterLabel}>Status</div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="">All</option>
            <option value="ok">OK</option>
            <option value="error">Error</option>
          </select>
        </div>
        <div>
          <div style={styles.filterLabel}>Pet</div>
          <select
            value={petFilter}
            onChange={(e) => setPetFilter(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="">All</option>
            {petIds.map((pid) => (
              <option key={pid} value={pid}>{pid}</option>
            ))}
          </select>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          {total} trace{total !== 1 ? 's' : ''}
        </div>
      </div>

      {/* List */}
      {traces.length === 0 ? (
        <div style={styles.emptyState}>
          <Activity size={24} strokeWidth={1.5} style={{ marginBottom: 'var(--space-2)', opacity: 0.4 }} />
          <div>No traces recorded yet.</div>
          <div style={{ fontSize: 'var(--text-xs)', marginTop: 'var(--space-2)' }}>
            Traces appear here when agents execute tasks.
          </div>
        </div>
      ) : (
        <div ref={scrollRef} onScroll={handleScroll} style={styles.listContainer}>
          {traces.map((t) => (
            <div
              key={t.id}
              onClick={() => onSelect(t.id)}
              style={styles.row}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = 'var(--nav-hover)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.background = 'transparent';
              }}
            >
              {/* Status icon */}
              {t.status === 'ok' ? (
                <CheckCircle size={14} strokeWidth={1.5} style={{ color: 'var(--success)', flexShrink: 0 }} />
              ) : t.status === 'running' ? (
                <Clock size={14} strokeWidth={1.5} style={{ color: 'var(--warning)', flexShrink: 0 }} />
              ) : (
                <XCircle size={14} strokeWidth={1.5} style={{ color: 'var(--danger)', flexShrink: 0 }} />
              )}

              {/* Time */}
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', minWidth: 64 }}>
                {relativeTime(t.start_time)}
              </span>

              {/* Duration */}
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', minWidth: 40, fontFamily: 'var(--font-mono)' }}>
                {formatDuration(t.start_time, t.end_time)}
              </span>

              {/* Pet name */}
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.pet_id ? t.pet_id : <span style={{ color: 'var(--text-tertiary)' }}>{'—'}</span>}
              </span>

              {/* Span count badge */}
              <span
                style={{
                  ...styles.badge,
                  background: 'var(--brand-glow)',
                  color: 'var(--brand-light)',
                }}
              >
                {t.span_count} span{t.span_count !== 1 ? 's' : ''}
              </span>
            </div>
          ))}
          {traces.length < total && (
            <div style={{ textAlign: 'center', padding: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              Scroll for more...
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Detail Page — Waterfall Chart
// ---------------------------------------------------------------------------

function WaterfallChart({
  spans,
  trace,
  selectedSpanId,
  onSelectSpan,
}: {
  spans: Span[];
  trace: Trace;
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
}) {
  if (spans.length === 0) {
    return (
      <div style={{ ...styles.emptyState, marginBottom: 'var(--space-4)' }}>
        No spans in this trace.
      </div>
    );
  }

  const ROW_HEIGHT = 28;
  const LABEL_WIDTH = 160;
  const DURATION_WIDTH = 70;
  const CHART_PADDING = 8;
  const SVG_MIN_WIDTH = 440;
  const BAR_HEIGHT = 16;
  const BAR_Y_OFFSET = (ROW_HEIGHT - BAR_HEIGHT) / 2;

  // Time range
  const traceStart = trace.startTime;
  const earliestStart = Math.min(...spans.map((s) => s.startTime));
  const latestEnd = Math.max(...spans.map((s) => s.endTime ?? s.startTime));
  const timeRange = Math.max(latestEnd - earliestStart, 1); // avoid divide-by-zero

  const chartWidth = Math.max(SVG_MIN_WIDTH - LABEL_WIDTH - DURATION_WIDTH, 200);

  const totalHeight = spans.length * ROW_HEIGHT + CHART_PADDING * 2;

  // Tooltip state
  const [tooltip, setTooltip] = useState<{ span: Span; x: number; y: number } | null>(null);

  return (
    <div style={styles.waterfallContainer}>
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
        Waterfall
      </div>
      <div style={{ position: 'relative' }}>
        <svg
          width={LABEL_WIDTH + chartWidth + DURATION_WIDTH}
          height={totalHeight}
          style={{ display: 'block' }}
        >
          {/* Time axis ticks */}
          {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
            const x = LABEL_WIDTH + frac * chartWidth;
            const ms = (frac * timeRange);
            const label = ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(1)}s`;
            return (
              <g key={frac}>
                <line
                  x1={x} y1={0} x2={x} y2={totalHeight}
                  stroke="var(--border-subtle)" strokeWidth={1}
                />
                <text
                  x={x} y={10}
                  fill="var(--text-tertiary)"
                  fontSize={10}
                  fontFamily="var(--font-mono)"
                  textAnchor="middle"
                >
                  {frac === 0 ? '0' : label}
                </text>
              </g>
            );
          })}

          {/* Span rows */}
          {spans.map((span, i) => {
            const startOffset = span.startTime - earliestStart;
            const end = span.endTime ?? span.startTime + 1;
            const duration = Math.max(end - span.startTime, 1);
            const barX = LABEL_WIDTH + (startOffset / timeRange) * chartWidth;
            const barWidth = Math.max((duration / timeRange) * chartWidth, 2);
            const y = CHART_PADDING + i * ROW_HEIGHT + BAR_Y_OFFSET;
            const isSelected = selectedSpanId === span.id;
            const color = spanColor(span.name);

            return (
              <g key={span.id}>
                {/* Label */}
                <text
                  x={LABEL_WIDTH - 8}
                  y={CHART_PADDING + i * ROW_HEIGHT + ROW_HEIGHT / 2 + 4}
                  fill={isSelected ? 'var(--text-primary)' : 'var(--text-secondary)'}
                  fontSize={11}
                  fontFamily="var(--font-mono)"
                  textAnchor="end"
                  style={{ cursor: 'pointer' }}
                  onClick={() => onSelectSpan(span.id)}
                >
                  {span.name.length > 18 ? span.name.slice(0, 18) + '...' : span.name}
                </text>

                {/* Bar */}
                <rect
                  x={barX}
                  y={y}
                  width={barWidth}
                  height={BAR_HEIGHT}
                  rx={3}
                  fill={color}
                  opacity={isSelected ? 1 : 0.7}
                  style={{ cursor: 'pointer', transition: 'opacity var(--duration-fast)' }}
                  onClick={() => onSelectSpan(span.id)}
                  onMouseEnter={(e) => {
                    const svgRect = (e.currentTarget as SVGElement).closest('svg')?.getBoundingClientRect();
                    if (svgRect) {
                      setTooltip({
                        span,
                        x: barX + barWidth / 2,
                        y: y,
                      });
                    }
                  }}
                  onMouseLeave={() => setTooltip(null)}
                />

                {/* Duration label */}
                <text
                  x={LABEL_WIDTH + chartWidth + 8}
                  y={CHART_PADDING + i * ROW_HEIGHT + ROW_HEIGHT / 2 + 4}
                  fill="var(--text-tertiary)"
                  fontSize={10}
                  fontFamily="var(--font-mono)"
                >
                  {formatDuration(span.startTime, span.endTime)}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div
            style={{
              position: 'absolute',
              left: tooltip.x,
              top: tooltip.y - 40,
              transform: 'translateX(-50%)',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-2) var(--space-3)',
              fontSize: 'var(--text-xs)',
              color: 'var(--text-primary)',
              pointerEvents: 'none',
              zIndex: 10,
              whiteSpace: 'nowrap',
              boxShadow: 'var(--shadow-surface)',
            }}
          >
            <div style={{ fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-1)' }}>
              {tooltip.span.name}
            </div>
            <div style={{ color: 'var(--text-tertiary)' }}>
              Start: {formatTime(tooltip.span.startTime)} &middot; Duration: {formatDuration(tooltip.span.startTime, tooltip.span.endTime)}
            </div>
            <div style={{ color: tooltip.span.status === 'error' ? 'var(--danger)' : 'var(--success)' }}>
              {tooltip.span.status}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail Page — Span Detail
// ---------------------------------------------------------------------------

function SpanDetailPanel({ span }: { span: Span }) {
  const attrs = span.attributes ?? {};
  const isTool = span.name === 'tool.execute';
  const isLlm = span.name === 'llm.call';

  return (
    <div style={styles.spanDetailContainer}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', color: 'var(--text-primary)' }}>
          {span.name}
        </span>
        <span
          style={{
            ...styles.badge,
            background: span.status === 'error' ? 'var(--danger-bg)' : 'var(--success-bg)',
            color: span.status === 'error' ? 'var(--danger)' : 'var(--success)',
          }}
        >
          {span.status}
        </span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          <Clock size={10} strokeWidth={1.5} style={{ marginRight: 'var(--space-1)', verticalAlign: 'middle' }} />
          {formatDuration(span.startTime, span.endTime)}
        </span>
      </div>

      {/* Highlighted fields for tool spans */}
      {isTool && Boolean(attrs.toolName) && (
        <div style={{ marginBottom: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Tool:</span>
          <span style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--font-semibold)',
            color: 'var(--success)',
            padding: '1px 6px',
            background: 'var(--success-bg)',
            borderRadius: 'var(--radius-sm)',
          }}>
            {String(attrs.toolName)}
          </span>
        </div>
      )}

      {/* Highlighted fields for LLM spans */}
      {isLlm && Boolean(attrs.model) && (
        <div style={{ marginBottom: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Model:</span>
          <span style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--brand-light)',
            padding: '1px 6px',
            background: 'var(--brand-glow)',
            borderRadius: 'var(--radius-sm)',
          }}>
            {String(attrs.model)}
          </span>
        </div>
      )}

      {/* Full attributes JSON */}
      {Object.keys(attrs).length > 0 && (
        <details open>
          <summary style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', cursor: 'pointer', marginBottom: 'var(--space-2)' }}>
            Attributes
          </summary>
          <pre style={styles.jsonBlock}>{JSON.stringify(attrs, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail Page
// ---------------------------------------------------------------------------

function TraceDetailPage({
  traceId,
  onBack,
}: {
  traceId: string;
  onBack: () => void;
}) {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [spans, setSpans] = useState<Span[]>([]);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    if (!window.settingsAPI?.traceDetail) return;
    window.settingsAPI.traceDetail(traceId).then((result) => {
      if (result) {
        setTrace(result.trace);
        setSpans(result.spans);
      }
      setHasLoaded(true);
    }).catch(() => setHasLoaded(true));
  }, [traceId]);

  if (!hasLoaded) {
    return (
      <div style={{ color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 'var(--space-10)' }}>
        Loading trace...
      </div>
    );
  }

  if (!trace) {
    return (
      <>
        <button onClick={onBack} style={styles.backBtn}>
          <ArrowLeft size={14} strokeWidth={1.5} /> Back
        </button>
        <div style={styles.emptyState}>Trace not found.</div>
      </>
    );
  }

  const selectedSpan = selectedSpanId ? spans.find((s) => s.id === selectedSpanId) ?? null : null;

  return (
    <>
      {/* Header */}
      <div style={styles.detailHeader}>
        <button onClick={onBack} style={styles.backBtn}>
          <ArrowLeft size={14} strokeWidth={1.5} /> Back
        </button>
        <span style={{ fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
          {truncateId(trace.id, 12)}
        </span>
        <span
          style={{
            ...styles.badge,
            background: trace.status === 'error' ? 'var(--danger-bg)' : trace.status === 'ok' ? 'var(--success-bg)' : 'var(--warning-bg)',
            color: trace.status === 'error' ? 'var(--danger)' : trace.status === 'ok' ? 'var(--success)' : 'var(--warning)',
          }}
        >
          {trace.status}
        </span>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>
          {formatDuration(trace.startTime, trace.endTime)}
        </span>
      </div>

      {/* Trace meta info */}
      <div style={{
        display: 'flex',
        gap: 'var(--space-4)',
        marginBottom: 'var(--space-4)',
        fontSize: 'var(--text-xs)',
        color: 'var(--text-tertiary)',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <Clock size={11} strokeWidth={1.5} /> {formatTime(trace.startTime)}
        </span>
        {trace.petId && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <User size={11} strokeWidth={1.5} /> {trace.petId}
          </span>
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
          <Hash size={11} strokeWidth={1.5} /> {spans.length} span{spans.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Waterfall chart */}
      <WaterfallChart
        spans={spans}
        trace={trace}
        selectedSpanId={selectedSpanId}
        onSelectSpan={setSelectedSpanId}
      />

      {/* Span detail */}
      {selectedSpan && <SpanDetailPanel span={selectedSpan} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main TracesTab component
// ---------------------------------------------------------------------------

export const TracesTab: React.FC = () => {
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);

  const handleSelectTrace = useCallback((traceId: string) => {
    setSelectedTraceId(traceId);
    setView('detail');
  }, []);

  const handleBack = useCallback(() => {
    setView('list');
    setSelectedTraceId(null);
  }, []);

  if (view === 'detail' && selectedTraceId) {
    return <TraceDetailPage traceId={selectedTraceId} onBack={handleBack} />;
  }

  return <TraceListPage onSelect={handleSelectTrace} />;
};
