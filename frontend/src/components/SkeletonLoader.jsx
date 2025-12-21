import './SkeletonLoader.css';

export function SkeletonTabs({ count = 4 }) {
  return (
    <div className="skeleton-tabs" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-tab" />
      ))}
    </div>
  );
}

export function SkeletonContent({ lines = 5, showHeader = true }) {
  return (
    <div className="skeleton-content" aria-hidden="true">
      {showHeader && <div className="skeleton-header" />}
      <div className="skeleton-lines">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="skeleton-line"
            style={{ width: `${70 + Math.random() * 30}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export function SkeletonStage({ title, tabCount = 4, lineCount = 6 }) {
  return (
    <div className="skeleton-stage" role="status" aria-label={`Loading ${title}`}>
      <div className="skeleton-stage-title" />
      <SkeletonTabs count={tabCount} />
      <SkeletonContent lines={lineCount} />
      <span className="sr-only">Loading {title}...</span>
    </div>
  );
}

export function SkeletonSynthesis() {
  return (
    <div className="skeleton-synthesis" role="status" aria-label="Loading synthesis">
      <div className="skeleton-stage-title" />
      <SkeletonContent lines={8} showHeader={false} />
      <span className="sr-only">Loading synthesis...</span>
    </div>
  );
}

export default function SkeletonLoader({ stage = 'all' }) {
  if (stage === 'stage1') {
    return <SkeletonStage title="Individual Responses" tabCount={4} lineCount={6} />;
  }

  if (stage === 'stage2') {
    return <SkeletonStage title="Peer Rankings" tabCount={4} lineCount={5} />;
  }

  if (stage === 'stage3') {
    return <SkeletonSynthesis />;
  }

  // Full loading skeleton for all stages
  return (
    <div className="skeleton-council" role="status" aria-label="Loading council response">
      <SkeletonStage title="Individual Responses" tabCount={4} lineCount={6} />
      <SkeletonStage title="Peer Rankings" tabCount={4} lineCount={5} />
      <SkeletonSynthesis />
      <span className="sr-only">Loading council deliberation...</span>
    </div>
  );
}
