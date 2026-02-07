import './ModelErrors.css';

/**
 * Group errors by category and render inline warning banners.
 *
 * Props:
 *   errors: Array<{ model, status_code, category, message }>
 */
export default function ModelErrors({ errors }) {
  if (!errors?.length) return null;

  // Group by category, collapsing transient/rate_limit/timeout into one bucket
  const groups = {};
  for (const err of errors) {
    const key = ['transient', 'rate_limit', 'timeout'].includes(err.category)
      ? 'transient'
      : err.category;
    if (!groups[key]) groups[key] = [];
    groups[key].push(err);
  }

  return (
    <div className="model-errors">
      {groups.billing && (
        <div className="model-errors-banner model-errors-banner--billing">
          <span className="model-errors-icon">💳</span>
          <div className="model-errors-body">
            <div className="model-errors-title">Insufficient OpenRouter credits</div>
            <div className="model-errors-detail">
              {groups.billing.length} model{groups.billing.length > 1 ? 's' : ''} failed due to billing.{' '}
              <a
                href="https://openrouter.ai/credits"
                target="_blank"
                rel="noopener noreferrer"
                className="model-errors-link"
              >
                Top up credits
              </a>
            </div>
            <div className="model-errors-models">
              {groups.billing.map((e) => e.model).join(', ')}
            </div>
          </div>
        </div>
      )}

      {groups.auth && (
        <div className="model-errors-banner model-errors-banner--auth">
          <span className="model-errors-icon">🔑</span>
          <div className="model-errors-body">
            <div className="model-errors-title">API key error</div>
            <div className="model-errors-detail">
              {groups.auth.length} model{groups.auth.length > 1 ? 's' : ''} rejected the API key. Check your OpenRouter API key configuration.
            </div>
            <div className="model-errors-models">
              {groups.auth.map((e) => e.model).join(', ')}
            </div>
          </div>
        </div>
      )}

      {groups.transient && (
        <div className="model-errors-banner model-errors-banner--transient">
          <span className="model-errors-icon">⚡</span>
          <div className="model-errors-body">
            <div className="model-errors-title">
              {groups.transient.length} model{groups.transient.length > 1 ? 's' : ''} unavailable
            </div>
            <div className="model-errors-models">
              {groups.transient.map((e) => e.model).join(', ')}
            </div>
          </div>
        </div>
      )}

      {groups.unknown && (
        <div className="model-errors-banner model-errors-banner--transient">
          <span className="model-errors-icon">⚠️</span>
          <div className="model-errors-body">
            <div className="model-errors-title">
              {groups.unknown.length} model{groups.unknown.length > 1 ? 's' : ''} failed
            </div>
            <div className="model-errors-models">
              {groups.unknown.map((e) => `${e.model}: ${e.message}`).join(', ')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
