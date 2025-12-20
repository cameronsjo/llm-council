import ReactMarkdown from 'react-markdown';
import './ArenaSynthesis.css';

export default function ArenaSynthesis({ synthesis, participantMapping }) {
  if (!synthesis) {
    return null;
  }

  return (
    <div className="arena-synthesis">
      <h3 className="synthesis-title">Final Synthesis</h3>

      <div className="synthesis-content">
        <div className="chairman-info">
          <span className="chairman-label">Synthesized by:</span>
          <span className="chairman-model">
            {synthesis.model?.split('/')[1] || synthesis.model || 'Chairman'}
          </span>
        </div>

        <div className="synthesis-text markdown-content">
          <ReactMarkdown>{synthesis.content}</ReactMarkdown>
        </div>
      </div>

      {participantMapping && Object.keys(participantMapping).length > 0 && (
        <div className="identity-reveal">
          <h4 className="reveal-title">Participant Identities</h4>
          <div className="participant-list">
            {Object.entries(participantMapping).map(([label, model]) => (
              <div key={label} className="participant-identity">
                <span className="identity-label">{label}</span>
                <span className="identity-arrow"></span>
                <span className="identity-model">{model.split('/')[1] || model}</span>
                <span className="identity-full-model">({model})</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
