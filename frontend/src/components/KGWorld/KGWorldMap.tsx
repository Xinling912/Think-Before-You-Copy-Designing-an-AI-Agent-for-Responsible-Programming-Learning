import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import {
  projectCategoryGraph,
  projectWorldGraph,
  resolveNodeRoles,
  searchNodes,
} from './data';
import { KGCategoryPanel } from './KGCategoryPanel';
import { KGDetailsDrawer, type KGSelection } from './KGDetailsDrawer';
import { KGGraphCanvas, type KGGraphCanvasHandle } from './KGGraphCanvas';
import { KGLegend } from './KGLegend';
import { englishKnowledgeOverview, type KGWorldLanguage } from './language';
import { KGToolbar } from './KGToolbar';
import type {
  KGCategoryGraph,
  KGLocation,
  KGOverview,
  KGRoleView,
  KGViewState,
  KGWorldGraph,
} from './types';
import './kg-world.css';

type KGWorldState = {
  viewState: KGViewState;
  activeCategoryID: string;
  selection: KGSelection;
  returnDuration: 800 | 900;
};

type KGWorldAction =
  | { type: 'ENTER_CATEGORY'; categoryID: string }
  | { type: 'NAVIGATE_CATEGORY'; categoryID: string }
  | { type: 'CATEGORY_ENTERED' }
  | { type: 'ENTER_DETAIL' }
  | { type: 'DETAIL_ENTERED' }
  | { type: 'RETURN_CATEGORY' }
  | { type: 'CATEGORY_RETURNED' }
  | { type: 'RETURN_WORLD' }
  | { type: 'WORLD_RETURNED' }
  | { type: 'SELECT'; selection: Exclude<KGSelection, { kind: 'none' }> }
  | { type: 'CLEAR_SELECTION' };

const transientStates = new Set<KGViewState>([
  'ENTERING_CATEGORY',
  'ENTERING_DETAIL',
  'RETURNING_TO_CATEGORY',
  'RETURNING_TO_WORLD',
]);

function isTransitionAction(action: KGWorldAction): boolean {
  return [
    'ENTER_CATEGORY',
    'ENTER_DETAIL',
    'RETURN_CATEGORY',
    'RETURN_WORLD',
  ].includes(action.type);
}

function kgWorldReducer(state: KGWorldState, action: KGWorldAction): KGWorldState {
  if (transientStates.has(state.viewState) && isTransitionAction(action)) return state;
  switch (action.type) {
    case 'ENTER_CATEGORY':
      if (state.viewState !== 'WORLD') return state;
      return {
        ...state,
        viewState: 'ENTERING_CATEGORY',
        activeCategoryID: action.categoryID,
      };
    case 'NAVIGATE_CATEGORY':
      if (state.viewState !== 'CATEGORY_FOCUS' && state.viewState !== 'CATEGORY_DETAIL') return state;
      return {
        ...state,
        viewState: 'ENTERING_CATEGORY',
        activeCategoryID: action.categoryID,
        selection: { kind: 'none' },
      };
    case 'CATEGORY_ENTERED':
      return state.viewState === 'ENTERING_CATEGORY'
        ? { ...state, viewState: 'CATEGORY_FOCUS' }
        : state;
    case 'ENTER_DETAIL':
      return state.viewState === 'CATEGORY_FOCUS'
        ? { ...state, viewState: 'ENTERING_DETAIL' }
        : state;
    case 'DETAIL_ENTERED':
      return state.viewState === 'ENTERING_DETAIL'
        ? { ...state, viewState: 'CATEGORY_DETAIL' }
        : state;
    case 'RETURN_CATEGORY':
      return state.viewState === 'CATEGORY_DETAIL'
        ? { ...state, viewState: 'RETURNING_TO_CATEGORY', selection: { kind: 'none' } }
        : state;
    case 'CATEGORY_RETURNED':
      return state.viewState === 'RETURNING_TO_CATEGORY'
        ? { ...state, viewState: 'CATEGORY_FOCUS' }
        : state;
    case 'RETURN_WORLD':
      if (state.viewState !== 'CATEGORY_FOCUS' && state.viewState !== 'CATEGORY_DETAIL') return state;
      return {
        ...state,
        viewState: 'RETURNING_TO_WORLD',
        returnDuration: state.viewState === 'CATEGORY_DETAIL' ? 900 : 800,
      };
    case 'WORLD_RETURNED':
      return state.viewState === 'RETURNING_TO_WORLD'
        ? {
            ...state,
            viewState: 'WORLD',
            activeCategoryID: '',
            selection: { kind: 'none' },
          }
        : state;
    case 'SELECT':
      return { ...state, selection: action.selection };
    case 'CLEAR_SELECTION':
      return { ...state, selection: { kind: 'none' } };
  }
}

function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const update = () => setReduced(media.matches);
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

function filterGraph(graph: KGWorldGraph, relationType: string): KGWorldGraph {
  if (relationType === 'all') return graph;
  const edges = graph.edges.filter((edge) => edge.data.relation_types.includes(relationType));
  const connectedNodeIDs = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  return {
    ...graph,
    edges,
    nodes: graph.nodes.map((node) => ({
      ...node,
      style: {
        ...node.style,
        ...(!connectedNodeIDs.has(node.id)
          ? { opacity: (node.style as { opacity?: number }).opacity === 0 ? 0 : 0.28 }
          : {}),
      },
    })),
  } as KGWorldGraph;
}

function normalizeRoleView(overview: KGOverview, view: KGRoleView | undefined): KGRoleView | undefined {
  if (!view) return undefined;
  const knownNodeIDs = new Set(overview.nodes.map((node) => node.node_id));
  const uniqueKnown = (values: string[]) =>
    [...new Set(values.filter((nodeID) => knownNodeIDs.has(nodeID)))];
  const upstream = uniqueKnown(view.upstream);
  const current = uniqueKnown(view.current);
  const downstream = uniqueKnown(view.downstream);
  const currentIDs = new Set(current);
  const focusNodeID = (view.focus_node_ids ?? []).find((nodeID) => currentIDs.has(nodeID))
    ?? current[0];
  const visualPairs = new Set(
    overview.visual_edges.map((edge) => `${edge.source}\u0000${edge.target}`),
  );
  const edges = (view.edges ?? []).filter((edge) =>
    knownNodeIDs.has(edge.from)
    && knownNodeIDs.has(edge.to)
    && visualPairs.has(`${edge.from}\u0000${edge.to}`),
  );
  return {
    upstream,
    current,
    downstream,
    edges,
    focus_node_ids: focusNodeID ? [focusNodeID] : [],
  };
}

export type KGWorldMapProps = {
  overview: KGOverview;
  roleView?: KGRoleView;
  initialLocation?: Partial<KGLocation>;
  className?: string;
  onCanvasUnsupported?: () => void;
  language?: KGWorldLanguage;
};

export function KGWorldMap({
  overview,
  roleView,
  initialLocation,
  className,
  onCanvasUnsupported,
  language = 'current',
}: KGWorldMapProps) {
  const [state, dispatch] = useReducer(kgWorldReducer, {
    viewState: 'WORLD',
    activeCategoryID: '',
    selection: { kind: 'none' },
    returnDuration: 800,
  });
  const canvasRef = useRef<KGGraphCanvasHandle>(null);
  const directNodeRef = useRef('');
  const directDetailRef = useRef(false);
  const detailTransitionStartedAtRef = useRef<number | undefined>(undefined);
  const detailTransitionTimerRef = useRef<number | undefined>(undefined);
  const initializedLocationRef = useRef(false);
  const reducedMotion = useReducedMotion();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [relationType, setRelationType] = useState('all');
  const [legendVisible, setLegendVisible] = useState(true);
  const [categoryFadeComplete, setCategoryFadeComplete] = useState(false);
  const [categoryPanelVisible, setCategoryPanelVisible] = useState(false);
  const [selectedPathID, setSelectedPathID] = useState('');
  const displayOverview = useMemo(
    () => language === 'en' ? englishKnowledgeOverview(overview) : overview,
    [language, overview],
  );

  const categories = useMemo(
    () => [...displayOverview.categories].sort((left, right) => left.order - right.order),
    [displayOverview.categories],
  );
  const categoryByID = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );
  const nodeByID = useMemo(
    () => new Map(displayOverview.nodes.map((node) => [node.node_id, node])),
    [displayOverview.nodes],
  );
  const pathByID = useMemo(
    () => new Map(displayOverview.paths.map((path) => [path.path_id, path])),
    [displayOverview.paths],
  );
  const activeCategory = categoryByID.get(state.activeCategoryID);
  const relationTypes = useMemo(
    () => [...new Set(displayOverview.relations.map((relation) => relation.type))].sort(),
    [displayOverview.relations],
  );
  const searchResults = useMemo(
    () => searchNodes(displayOverview, debouncedQuery),
    [debouncedQuery, displayOverview],
  );
  const activePath = selectedPathID ? pathByID.get(selectedPathID) : undefined;
  const suppliedRoleView = useMemo(
    () => normalizeRoleView(displayOverview, roleView),
    [displayOverview, roleView],
  );
  const transientPathID = initialLocation?.pathID
    && !pathByID.has(initialLocation.pathID)
    && suppliedRoleView
    ? initialLocation.pathID
    : '';
  const suppliedRoleEnabled = transientPathID
    ? selectedPathID === transientPathID
    : Boolean(suppliedRoleView);
  const effectiveRoleView = useMemo(() => normalizeRoleView(displayOverview, activePath
    ? {
        upstream: activePath.upstream,
        current: activePath.focus,
        downstream: activePath.downstream,
        focus_node_ids: activePath.focus_node_ids,
        edges: activePath.relations.map((relation) => ({
          from: relation.from,
          to: relation.to,
          type: relation.type,
          relation: relation.type,
          traversal: relation.traversal === 'reverse' ? 'reverse' : 'forward',
        })),
      }
    : suppliedRoleEnabled ? suppliedRoleView : undefined),
  [activePath, displayOverview, suppliedRoleEnabled, suppliedRoleView]);
  const passiveFocusNodeID = effectiveRoleView?.focus_node_ids?.[0]
    ?? (!initialLocation?.pathID && initialLocation?.focusNodeID && nodeByID.has(initialLocation.focusNodeID)
      ? initialLocation.focusNodeID
      : undefined);
  const roleByNodeID = useMemo(
    () => resolveNodeRoles(effectiveRoleView ?? { upstream: [], current: [], downstream: [] }),
    [effectiveRoleView],
  );
  const pathNodeIDs = useMemo(() => {
    if (activePath) {
      return new Set([
        ...activePath.path,
        ...activePath.upstream,
        ...activePath.focus,
        ...activePath.downstream,
        ...activePath.relations.flatMap((relation) => [relation.from, relation.to]),
      ]);
    }
    if (!selectedPathID || !effectiveRoleView) return undefined;
    return new Set([
      ...effectiveRoleView.upstream,
      ...effectiveRoleView.current,
      ...effectiveRoleView.downstream,
      ...(effectiveRoleView.edges ?? []).flatMap((edge) => [edge.from, edge.to]),
    ]);
  }, [activePath, effectiveRoleView, selectedPathID]);
  const pathEdgeIDs = useMemo(() => {
    const pathRelations = activePath?.relations ?? (
      selectedPathID ? effectiveRoleView?.edges ?? [] : []
    );
    if (pathRelations.length === 0) return undefined;
    return new Set(displayOverview.visual_edges.flatMap((edge) =>
      pathRelations.some((relation) =>
        relation.from === edge.source
        && relation.to === edge.target
        && (!('type' in relation) || !relation.type || edge.relation_types.includes(relation.type)),
      ) ? [edge.key] : [],
    ));
  }, [activePath, displayOverview.visual_edges, effectiveRoleView, selectedPathID]);

  const projected = useMemo<KGWorldGraph | KGCategoryGraph>(() => {
    if (state.viewState === 'ENTERING_CATEGORY' && !categoryFadeComplete) {
      const world = projectWorldGraph(displayOverview);
      return {
        ...world,
        nodes: world.nodes.map((node) => ({
          ...node,
          style: {
            ...node.style,
            opacity: node.data.category_id === state.activeCategoryID ? 1 : 0,
          },
        })),
      } as KGWorldGraph;
    }
    if (state.activeCategoryID && state.viewState !== 'WORLD' && state.viewState !== 'RETURNING_TO_WORLD') {
      const category = projectCategoryGraph(displayOverview, state.activeCategoryID);
      if (
        state.viewState === 'ENTERING_CATEGORY'
        || state.viewState === 'CATEGORY_FOCUS'
        || state.viewState === 'RETURNING_TO_CATEGORY'
      ) {
        return {
          ...category,
          nodes: category.nodes.map((node) => ({
            ...node,
            style: { ...node.style, size: 12 },
          })),
        };
      }
      return category;
    }
    return projectWorldGraph(displayOverview);
  }, [categoryFadeComplete, displayOverview, state.activeCategoryID, state.viewState]);
  const graph = useMemo(
    () => filterGraph(projected, relationType),
    [projected, relationType],
  );
  const ports = 'ports' in projected
    && (state.viewState === 'ENTERING_DETAIL' || state.viewState === 'CATEGORY_DETAIL')
    ? projected.ports
    : undefined;
  const selectedNodeID = state.selection.kind === 'node' ? state.selection.nodeID : undefined;
  const selectedEdgeID = state.selection.kind === 'edge' ? state.selection.edgeID : undefined;
  const pathsForCategory = useMemo(
    () => displayOverview.paths
      .filter((path) => path.category_ids.includes(state.activeCategoryID))
      .sort((left, right) => left.path_id.localeCompare(right.path_id)),
    [displayOverview.paths, state.activeCategoryID],
  );
  const transientPathSelected = Boolean(
    transientPathID && selectedPathID === transientPathID,
  );
  const transitionLocked = transientStates.has(state.viewState);
  const drawerSelection: KGSelection = state.selection;
  const drawerOffset = drawerSelection.kind === 'node'
    ? '416px'
    : drawerSelection.kind === 'edge' || drawerSelection.kind === 'port'
      ? '456px'
      : undefined;
  const drawerViewportInset = drawerSelection.kind === 'node'
    ? 418
    : drawerSelection.kind === 'edge' || drawerSelection.kind === 'port'
      ? 458
      : 0;

  const reconcileSelectedPathForCategory = (categoryID: string) => {
    setSelectedPathID((currentPathID) => {
      if (!currentPathID) return currentPathID;
      const storedPath = pathByID.get(currentPathID);
      if (storedPath) return storedPath.category_ids.includes(categoryID) ? currentPathID : '';
      const roleCategoryIDs = new Set([
        ...(suppliedRoleView?.upstream ?? []),
        ...(suppliedRoleView?.current ?? []),
        ...(suppliedRoleView?.downstream ?? []),
      ].map((nodeID) => nodeByID.get(nodeID)?.category_id).filter(Boolean));
      return roleCategoryIDs.has(categoryID) ? currentPathID : '';
    });
  };

  const completeDetailTransition = useCallback(() => {
    if (detailTransitionTimerRef.current !== undefined) {
      window.clearTimeout(detailTransitionTimerRef.current);
      detailTransitionTimerRef.current = undefined;
    }
    detailTransitionStartedAtRef.current = undefined;
    directNodeRef.current = '';
    directDetailRef.current = false;
    if (process.env.NODE_ENV !== 'production') {
      window.dispatchEvent(new CustomEvent('kg-world-transition-debug', {
        detail: { phase: 'detail-dispatch', timestamp: performance.now() },
      }));
    }
    dispatch({ type: 'DETAIL_ENTERED' });
  }, []);

  const beginDetailTransition = useCallback(() => {
    detailTransitionStartedAtRef.current = performance.now();
    if (!reducedMotion) {
      if (detailTransitionTimerRef.current !== undefined) {
        window.clearTimeout(detailTransitionTimerRef.current);
      }
      detailTransitionTimerRef.current = window.setTimeout(completeDetailTransition, 500);
    }
    dispatch({ type: 'ENTER_DETAIL' });
  }, [completeDetailTransition, reducedMotion]);

  useEffect(() => () => {
    if (detailTransitionTimerRef.current !== undefined) {
      window.clearTimeout(detailTransitionTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (transitionLocked) return undefined;
    const timer = window.setTimeout(() => setDebouncedQuery(query), 180);
    return () => window.clearTimeout(timer);
  }, [query, transitionLocked]);

  useEffect(() => {
    if (!transitionLocked && searchResults.length === 1 && debouncedQuery.trim()) {
      dispatch({ type: 'SELECT', selection: { kind: 'node', nodeID: searchResults[0].node_id } });
    }
  }, [debouncedQuery, searchResults, transitionLocked]);

  useEffect(() => {
    if (state.viewState !== 'ENTERING_CATEGORY') return undefined;
    if (reducedMotion) {
      setCategoryFadeComplete(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setCategoryFadeComplete(true), 400);
    return () => window.clearTimeout(timer);
  }, [reducedMotion, state.viewState]);

  useEffect(() => {
    if (state.viewState !== 'ENTERING_CATEGORY') return undefined;
    if (reducedMotion) {
      setCategoryPanelVisible(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setCategoryPanelVisible(true), 520);
    return () => window.clearTimeout(timer);
  }, [reducedMotion, state.viewState]);

  useEffect(() => {
    if (state.viewState !== 'ENTERING_CATEGORY' || !categoryFadeComplete) return undefined;
    if (!reducedMotion) {
      void canvasRef.current?.focusCategory(state.activeCategoryID, 400);
      return undefined;
    }
    let cancelled = false;
    let frameID: number | undefined;
    void Promise.resolve(canvasRef.current?.focusCategory(state.activeCategoryID, 800))
      .catch(() => undefined)
      .then(() => {
        if (cancelled) return;
        frameID = window.requestAnimationFrame(() => {
          if (cancelled) return;
          dispatch({ type: 'CATEGORY_ENTERED' });
          if (directDetailRef.current) beginDetailTransition();
        });
      });
    return () => {
      cancelled = true;
      if (frameID !== undefined) window.cancelAnimationFrame(frameID);
    };
  }, [beginDetailTransition, categoryFadeComplete, reducedMotion,
    state.activeCategoryID, state.viewState]);

  useEffect(() => {
    if (initializedLocationRef.current) return;
    initializedLocationRef.current = true;
    const initialPath = initialLocation?.pathID ? pathByID.get(initialLocation.pathID) : undefined;
    const requestedFocusID = transientPathID
      ? suppliedRoleView?.focus_node_ids?.[0] ?? ''
      : initialLocation?.focusNodeID ?? '';
    const focusNode = requestedFocusID
      ? nodeByID.get(requestedFocusID)
      : undefined;
    const requestedCategoryID = initialLocation?.categoryID && categoryByID.has(initialLocation.categoryID)
      ? initialLocation.categoryID
      : '';
    const categoryID = focusNode?.category_id
      || (initialPath
        ? initialPath.category_ids.includes(requestedCategoryID)
          ? requestedCategoryID
          : initialPath.category_ids[0]
        : requestedCategoryID)
      || '';
    if (!categoryByID.has(categoryID)) return;
    setCategoryFadeComplete(false);
    if (initialPath || transientPathID) {
      setSelectedPathID(initialPath?.path_id ?? transientPathID);
      directDetailRef.current = true;
    }
    dispatch({ type: 'ENTER_CATEGORY', categoryID });
  }, [categoryByID, initialLocation, nodeByID, pathByID, suppliedRoleView, transientPathID]);

  useEffect(() => {
    let timeoutID: number | undefined;
    let frameID: number | undefined;
    let cancelled = false;
    const complete = (
      callback: () => void,
      duration: number,
      cameraTransition?: Promise<void>,
    ) => {
      if (reducedMotion) {
        void Promise.resolve(cameraTransition)
          .catch(() => undefined)
          .then(() => {
            if (cancelled) return;
            const requestFrame = window.requestAnimationFrame
              ?? ((next: FrameRequestCallback) => window.setTimeout(() => next(performance.now()), 16));
            frameID = requestFrame(() => {
              if (!cancelled) callback();
            });
          });
      } else {
        timeoutID = window.setTimeout(callback, duration);
      }
    };

    if (state.viewState === 'ENTERING_CATEGORY') {
      if (reducedMotion) return undefined;
      const cameraTransition = canvasRef.current?.focusCategory(state.activeCategoryID, 400);
      complete(() => {
        dispatch({ type: 'CATEGORY_ENTERED' });
        if (directDetailRef.current) beginDetailTransition();
      }, 800, cameraTransition);
    } else if (state.viewState === 'ENTERING_DETAIL') {
      const startedAt = detailTransitionStartedAtRef.current ?? performance.now();
      const remainingDuration = Math.max(0, 500 - (performance.now() - startedAt));
      const cameraTransition = canvasRef.current?.fitView(64, remainingDuration, true);
      if (reducedMotion) {
        complete(completeDetailTransition, remainingDuration, cameraTransition);
      } else if (detailTransitionTimerRef.current === undefined) {
        detailTransitionTimerRef.current = window.setTimeout(
          completeDetailTransition,
          remainingDuration,
        );
      }
    } else if (state.viewState === 'RETURNING_TO_CATEGORY') {
      const cameraTransition = canvasRef.current?.focusCategory(state.activeCategoryID, 400);
      complete(() => dispatch({ type: 'CATEGORY_RETURNED' }), 400, cameraTransition);
    } else if (state.viewState === 'RETURNING_TO_WORLD') {
      const cameraTransition = canvasRef.current?.fitView(64, state.returnDuration);
      complete(
        () => dispatch({ type: 'WORLD_RETURNED' }),
        state.returnDuration,
        cameraTransition,
      );
    }

    return () => {
      cancelled = true;
      if (timeoutID !== undefined) window.clearTimeout(timeoutID);
      if (frameID !== undefined) window.cancelAnimationFrame?.(frameID);
    };
  }, [
    reducedMotion,
    beginDetailTransition,
    completeDetailTransition,
    selectedNodeID,
    state.activeCategoryID,
    state.returnDuration,
    state.viewState,
  ]);

  const enterCategory = (categoryID: string) => {
    if (transitionLocked || (state.viewState !== 'WORLD' && state.viewState !== 'CATEGORY_FOCUS')) return;
    directNodeRef.current = '';
    directDetailRef.current = false;
    reconcileSelectedPathForCategory(categoryID);
    setCategoryFadeComplete(false);
    setCategoryPanelVisible(false);
    dispatch({ type: 'CLEAR_SELECTION' });
    dispatch({ type: state.viewState === 'WORLD' ? 'ENTER_CATEGORY' : 'NAVIGATE_CATEGORY', categoryID });
  };

  const enterNode = (nodeID: string) => {
    if (transitionLocked) return;
    const node = nodeByID.get(nodeID);
    if (!node) return;
    reconcileSelectedPathForCategory(node.category_id);
    dispatch({ type: 'SELECT', selection: { kind: 'node', nodeID } });
  };

  const handleEscape = () => {
    if (transitionLocked) return;
    if (state.selection.kind !== 'none') {
      dispatch({ type: 'CLEAR_SELECTION' });
    } else if (state.viewState === 'CATEGORY_DETAIL') {
      dispatch({ type: 'RETURN_CATEGORY' });
    } else if (state.viewState === 'CATEGORY_FOCUS') {
      dispatch({ type: 'RETURN_WORLD' });
    }
  };

  return (
    <section
      className={['kg-world-map', className].filter(Boolean).join(' ')}
      data-state={state.viewState}
      data-camera-left-reserve="424"
      style={{
        '--kg-camera-left-reserve': '424px',
        '--kg-fit-padding': '64px',
        ...(drawerOffset ? { '--kg-drawer-offset': drawerOffset } : {}),
      } as React.CSSProperties}
    >
      <output className="kg-world-map__state" data-testid="kg-view-state" aria-live="polite">
        {state.viewState}
      </output>
      <div
        className="kg-world-map__graph-layout"
        data-legend-visible={legendVisible ? 'true' : 'false'}
      >
        <KGGraphCanvas
        ref={canvasRef}
        graph={graph}
        categories={categories}
        ports={ports}
        selectedNodeID={selectedNodeID}
        selectedEdgeID={selectedEdgeID}
        activeCategoryID={state.activeCategoryID || undefined}
        roleByNodeID={roleByNodeID}
        viewState={state.viewState}
        dataVersion={displayOverview.version}
        reducedMotion={reducedMotion}
        focusNodeID={passiveFocusNodeID}
        pathNodeIDs={pathNodeIDs}
        pathEdgeIDs={pathEdgeIDs}
        rightViewportInset={drawerViewportInset}
        aria-label={language === 'en' ? 'Knowledge World canvas' : '知识世界画布'}
        onNodeClick={enterNode}
        onEdgeClick={(edgeID) => dispatch({ type: 'SELECT', selection: { kind: 'edge', edgeID } })}
        onPortClick={(portID) => dispatch({ type: 'SELECT', selection: { kind: 'port', portID } })}
        onCanvasClick={() => dispatch({ type: 'CLEAR_SELECTION' })}
        onCanvasUnsupported={onCanvasUnsupported}
          onEscape={handleEscape}
        />
        {legendVisible && state.viewState !== 'CATEGORY_DETAIL' ? (
          <KGLegend
            categories={categories}
            activeCategoryID={state.activeCategoryID || undefined}
            disabled={transitionLocked}
            onSelectCategory={enterCategory}
          />
        ) : state.viewState !== 'CATEGORY_DETAIL' ? (
          <button
            type="button"
            className="kg-world-legend-toggle"
            aria-label={language === 'en' ? 'Legend' : '图例'}
            onClick={() => setLegendVisible(true)}
          >
            {language === 'en' ? 'Legend' : '图例'}
          </button>
          ) : null}
      </div>
      <KGToolbar
        query={query}
        results={searchResults}
        searched={Boolean(debouncedQuery.trim())}
        relationTypes={relationTypes}
        relationType={relationType}
        legendVisible={legendVisible}
        viewState={state.viewState}
        transitionLocked={transitionLocked}
        onQueryChange={setQuery}
        onResultSelect={enterNode}
        onRelationTypeChange={setRelationType}
        onResetFilter={() => setRelationType('all')}
        onFit={() => void canvasRef.current?.fitView(64)}
        onResetLayout={() => void canvasRef.current?.resetLayout()}
        onToggleLegend={() => setLegendVisible((visible) => !visible)}
      />
      {(state.viewState === 'CATEGORY_FOCUS'
        || (state.viewState === 'ENTERING_CATEGORY' && categoryPanelVisible))
      && activeCategory ? (
        <KGCategoryPanel
          category={activeCategory}
          transitioning={state.viewState === 'ENTERING_CATEGORY'}
          onEnterDetail={beginDetailTransition}
          onReturnWorld={() => dispatch({ type: 'RETURN_WORLD' })}
          language={language}
        />
      ) : null}
      {state.viewState === 'CATEGORY_DETAIL' ? (
        <nav
          className="kg-detail-navigation"
          aria-label={language === 'en' ? 'Category details navigation' : '区域详情导航'}
        >
          <label>
            <span>{language === 'en' ? 'Learning path' : '学习路径'}</span>
            <select
              aria-label={language === 'en' ? 'Learning path' : '学习路径'}
              value={selectedPathID}
              onChange={(event) => setSelectedPathID(event.target.value)}
            >
              <option value="">{language === 'en' ? 'Clear path highlight' : '清除路径高亮'}</option>
              {transientPathSelected ? (
                <option value={selectedPathID}>
                  {selectedPathID} · {language === 'en' ? 'Current turn path' : '本回合路径'}
                </option>
              ) : null}
              {pathsForCategory.map((path) => (
                <option key={path.path_id} value={path.path_id}>
                  {path.path_id} · {path.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => dispatch({ type: 'RETURN_CATEGORY' })}>
            {language === 'en' ? 'Categories' : '分类'}
          </button>
          <button type="button" onClick={() => dispatch({ type: 'RETURN_WORLD' })}>
            {language === 'en' ? 'Back to Knowledge World' : '返回知识世界'}
          </button>
        </nav>
      ) : null}
      <KGDetailsDrawer
        overview={displayOverview}
        selection={drawerSelection}
        ports={ports ?? []}
        reducedMotion={reducedMotion}
        language={language}
        onClose={() => dispatch({ type: 'CLEAR_SELECTION' })}
        onNavigateCategory={(categoryID) => {
          setCategoryFadeComplete(false);
          setCategoryPanelVisible(false);
          reconcileSelectedPathForCategory(categoryID);
          dispatch({ type: 'NAVIGATE_CATEGORY', categoryID });
        }}
      />
    </section>
  );
}
