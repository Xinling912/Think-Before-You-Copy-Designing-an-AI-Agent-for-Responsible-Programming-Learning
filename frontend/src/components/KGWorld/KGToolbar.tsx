import type { KeyboardEvent } from 'react';

import type { KGNode, KGViewState } from './types';

export type KGToolbarProps = {
  query: string;
  results: KGNode[];
  searched: boolean;
  relationTypes: string[];
  relationType: string;
  legendVisible: boolean;
  viewState: KGViewState;
  transitionLocked: boolean;
  onQueryChange: (query: string) => void;
  onResultSelect: (nodeID: string) => void;
  onRelationTypeChange: (relationType: string) => void;
  onResetFilter: () => void;
  onFit: () => void;
  onResetLayout: () => void;
  onToggleLegend: () => void;
};

export function KGToolbar({
  query,
  results,
  searched,
  relationTypes,
  relationType,
  legendVisible,
  viewState,
  transitionLocked,
  onQueryChange,
  onResultSelect,
  onRelationTypeChange,
  onResetFilter,
  onFit,
  onResetLayout,
  onToggleLegend,
}: KGToolbarProps) {
  const showMapControls = viewState !== 'CATEGORY_DETAIL' && viewState !== 'ENTERING_DETAIL';
  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowDown' || results.length === 0) return;
    event.preventDefault();
    document.getElementById(`kg-search-result-${results[0].node_id}`)?.focus();
  };

  return (
    <div className="kg-world-toolbar" aria-label="Knowledge World toolbar">
      <div className="kg-world-toolbar__primary">
        <div className="kg-search-control">
          <label htmlFor="kg-node-search">Search knowledge nodes</label>
          <input
            id="kg-node-search"
            type="search"
            value={query}
            disabled={transitionLocked}
            placeholder="Node name, ID, or alias"
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={onSearchKeyDown}
            aria-controls="kg-search-results"
          />
          {searched ? (
            <div id="kg-search-results" className="kg-search-results" role="listbox">
              {results.length > 0 ? results.map((node, index) => (
                <button
                  id={`kg-search-result-${node.node_id}`}
                  key={node.node_id}
                  type="button"
                  disabled={transitionLocked}
                  role="option"
                  aria-selected={index === 0}
                  aria-label={`${node.label} · ${node.node_id}`}
                  onClick={() => onResultSelect(node.node_id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') onResultSelect(node.node_id);
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      document.getElementById(
                        `kg-search-result-${results[(index + 1) % results.length].node_id}`,
                      )?.focus();
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      document.getElementById(
                        `kg-search-result-${results[(index - 1 + results.length) % results.length].node_id}`,
                      )?.focus();
                    }
                  }}
                >
                  <span>{node.label}</span>
                  <small>{node.node_id}</small>
                </button>
              )) : <p>No matching nodes</p>}
            </div>
          ) : null}
        </div>

        <label className="kg-relation-control">
          <span>Relation type</span>
          <select
            aria-label="Relation type"
            value={relationType}
            disabled={transitionLocked}
            onChange={(event) => onRelationTypeChange(event.target.value)}
          >
            <option value="all">All relations</option>
            {relationTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <button type="button" disabled={transitionLocked} onClick={onResetFilter}>Reset filters</button>
        {showMapControls ? (
          <>
            <button type="button" disabled={transitionLocked} onClick={onFit}>Fit view</button>
            <button type="button" disabled={transitionLocked} onClick={onResetLayout}>Reset layout</button>
            <button type="button" disabled={transitionLocked} onClick={onToggleLegend}>
              {legendVisible ? 'Hide legend' : 'Show legend'}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
