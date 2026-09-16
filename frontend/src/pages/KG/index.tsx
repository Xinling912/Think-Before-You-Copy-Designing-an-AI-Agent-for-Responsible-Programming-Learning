import { ReloadOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { parseKGLocation, validateOverview } from '../../components/KGWorld/data';
import { KGWorldMap } from '../../components/KGWorld/KGWorldMap';
import { readTransientPathSnapshot } from '../../components/KGWorld/transientPath';
import type { KGOverview } from '../../components/KGWorld/types';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; overview: KGOverview }
  | { kind: 'request-error'; detail: string }
  | { kind: 'integrity-error'; errors: string[] };

const SKELETON_FADE_MS = 180;

export default function KGPage() {
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [skeletonVisible, setSkeletonVisible] = useState(true);
  const [skeletonExiting, setSkeletonExiting] = useState(false);
  const [canvasUnsupported, setCanvasUnsupported] = useState(false);
  const fadeTimerRef = useRef<number | undefined>(undefined);
  const requestGenerationRef = useRef(0);
  const initialLocation = useMemo(
    () => parseKGLocation(typeof window === 'undefined' ? '' : window.location.search),
    [],
  );

  const clearFadeTimer = useCallback(() => {
    if (fadeTimerRef.current !== undefined) {
      window.clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = undefined;
    }
  }, []);

  const loadOverview = useCallback(async () => {
    const generation = ++requestGenerationRef.current;
    clearFadeTimer();
    setCanvasUnsupported(false);
    setSkeletonVisible(true);
    setSkeletonExiting(false);
    setLoadState({ kind: 'loading' });
    try {
      const response = await fetch('/api/kg/overview');
      if (!response.ok) {
        const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
        throw new Error(`HTTP ${status}`);
      }
      const payload: unknown = await response.json();
      if (requestGenerationRef.current !== generation) return;
      const validation = validateOverview(payload);
      if (!validation.valid) {
        setSkeletonVisible(false);
        setLoadState({ kind: 'integrity-error', errors: validation.errors });
        return;
      }
      setLoadState({ kind: 'ready', overview: payload as KGOverview });
      setSkeletonExiting(true);
      fadeTimerRef.current = window.setTimeout(() => {
        if (requestGenerationRef.current === generation) setSkeletonVisible(false);
        fadeTimerRef.current = undefined;
      }, SKELETON_FADE_MS);
    } catch (error) {
      if (requestGenerationRef.current !== generation) return;
      setSkeletonVisible(false);
      setLoadState({
        kind: 'request-error',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }, [clearFadeTimer]);

  useEffect(() => {
    void loadOverview();
    return () => {
      requestGenerationRef.current += 1;
      clearFadeTimer();
    };
  }, [clearFadeTimer, loadOverview]);

  const overview = loadState.kind === 'ready' ? loadState.overview : undefined;
  const transientRoleView = useMemo(() => {
    if (!overview || !initialLocation.pathID) return undefined;
    if (overview.paths.some((path) => path.path_id === initialLocation.pathID)) return undefined;
    return readTransientPathSnapshot(initialLocation.pathID, overview);
  }, [initialLocation.pathID, overview]);

  return (
    <main className="rea-page kg-explorer-page">
      <section className="rea-header kg-explorer-header">
        <div>
          <div className="rea-kicker">Knowledge Graph</div>
          <h1 className="rea-title">Knowledge graph</h1>
        </div>
        <div className="kg-explorer-header-actions">
          {overview ? (
            <>
              <MiniMetric label="Nodes" value={overview.counts.nodes} />
              <MiniMetric label="Categories" value={overview.counts.categories} />
              <MiniMetric label="Relations" value={overview.counts.unique_relation_triples} />
              <MiniMetric label="Paths" value={overview.counts.paths} />
            </>
          ) : null}
          <Button
            aria-label="Reload"
            icon={<ReloadOutlined />}
            onClick={() => void loadOverview()}
            loading={loadState.kind === 'loading'}
          >
            Reload
          </Button>
        </div>
      </section>

      <section className="kg-explorer-viewport" aria-label="Knowledge World">
        {loadState.kind === 'request-error' ? (
          <LoadErrorPanel detail={loadState.detail} onReload={loadOverview} />
        ) : null}
        {loadState.kind === 'integrity-error' ? (
          <IntegrityErrorPanel errors={loadState.errors} onReload={loadOverview} />
        ) : null}
        {overview && canvasUnsupported ? <KGReadOnlyFallback overview={overview} /> : null}
        {overview && !canvasUnsupported ? (
          <KGWorldMap
            overview={overview}
            roleView={transientRoleView}
            initialLocation={initialLocation}
            onCanvasUnsupported={() => setCanvasUnsupported(true)}
          />
        ) : null}
        {skeletonVisible ? <KGWorldSkeleton exiting={skeletonExiting} /> : null}
      </section>
    </main>
  );
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="kg-explorer-mini-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function KGWorldSkeleton({ exiting }: { exiting: boolean }) {
  return (
    <div
      className={`kg-world-skeleton${exiting ? ' is-exiting' : ''}`}
      data-testid="kg-world-skeleton"
      aria-label="Loading Knowledge World"
      aria-hidden={exiting}
    >
      <div className="kg-world-skeleton__regions">
        {Array.from({ length: 6 }, (_, index) => (
          <span key={index} data-testid="kg-skeleton-region" />
        ))}
      </div>
      <div className="kg-world-skeleton__nodes">
        {Array.from({ length: 24 }, (_, index) => (
          <span key={index} data-testid="kg-skeleton-node" />
        ))}
      </div>
    </div>
  );
}

function LoadErrorPanel({ detail, onReload }: { detail: string; onReload: () => Promise<void> }) {
  return (
    <section className="kg-world-status-panel" role="alert">
      <p className="rea-kicker">Knowledge World</p>
      <h2>Knowledge World failed to load</h2>
      <p>Unable to load knowledge graph data. Please reload.</p>
      <code>{detail}</code>
      <Button type="primary" onClick={() => void onReload()}>Reload</Button>
    </section>
  );
}

function IntegrityErrorPanel({ errors, onReload }: { errors: string[]; onReload: () => Promise<void> }) {
  return (
    <section className="kg-world-status-panel" role="alert">
      <p className="rea-kicker">Integrity Check</p>
      <h2>Knowledge graph integrity error</h2>
      <ul>
        {errors.filter(Boolean).map((error) => <li key={error}>{error}</li>)}
      </ul>
      <Button type="primary" onClick={() => void onReload()}>Reload</Button>
    </section>
  );
}

function KGReadOnlyFallback({ overview }: { overview: KGOverview }) {
  return (
    <section className="kg-readonly-fallback" data-testid="kg-readonly-fallback">
      <header>
        <p className="rea-kicker">Read-only Knowledge World</p>
        <h2>Canvas is unavailable in this browser. The content remains accessible in read-only form.</h2>
      </header>
      <section aria-labelledby="kg-fallback-categories">
        <h2 id="kg-fallback-categories">Knowledge categories</h2>
        <div className="kg-readonly-fallback__categories">
          {overview.categories.map((category) => (
            <article key={category.id} style={{ borderColor: category.color }}>
              <h3>{category.label_en}</h3>
              <small>{category.node_count} nodes</small>
            </article>
          ))}
        </div>
      </section>
      <details open>
        <summary>Nodes · {overview.counts.nodes}</summary>
        <ul className="kg-readonly-fallback__records">
          {overview.nodes.map((node) => (
            <li key={node.node_id}>
              <strong>{node.label}</strong>
              <code>{node.node_id}</code>
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary>Learning paths · {overview.counts.paths}</summary>
        <ul className="kg-readonly-fallback__records">
          {overview.paths.map((path) => (
            <li key={path.path_id}>
              <strong>{path.label}</strong>
              <code>{path.path_id}</code>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
