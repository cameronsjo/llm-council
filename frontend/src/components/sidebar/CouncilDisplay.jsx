import { useState } from 'react';
import { Star } from 'lucide-react';

/**
 * Extract short model name from full identifier.
 * e.g., "openai/gpt-4" -> "Gpt-4"
 */
function getShortModelName(model) {
  const name = model.split('/').pop();
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Council members display with expand/collapse and action buttons.
 */
export function CouncilDisplay({
  councilModels,
  chairmanModel,
  onOpenConfig,
  onOpenCuration,
}) {
  const [showModels, setShowModels] = useState(false);

  if (councilModels.length === 0) {
    return null;
  }

  return (
    <div className="council-config">
      <div className="council-header">
        <button
          className="council-toggle"
          onClick={() => setShowModels(!showModels)}
        >
          <span>Council Members</span>
          <span className="toggle-icon">{showModels ? '▼' : '▶'}</span>
        </button>
        <div className="council-actions">
          <button
            className="curate-btn"
            onClick={onOpenCuration}
            title="Curate models"
          >
            <Star size={14} />
          </button>
          <button
            className="configure-btn"
            onClick={onOpenConfig}
            title="Configure council"
          >
            ⚙️
          </button>
        </div>
      </div>

      {showModels && (
        <div className="council-models">
          {councilModels.map((model, idx) => (
            <div key={idx} className="model-item">
              <span className="model-badge">
                {model === chairmanModel ? '👑' : ''}
              </span>
              <span className="model-name" title={model}>
                {getShortModelName(model)}
              </span>
            </div>
          ))}
          {chairmanModel && !councilModels.includes(chairmanModel) && (
            <div className="model-item chairman">
              <span className="model-badge">👑</span>
              <span className="model-name" title={chairmanModel}>
                {getShortModelName(chairmanModel)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
