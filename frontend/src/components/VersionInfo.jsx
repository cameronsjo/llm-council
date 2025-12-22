import { useState, useEffect } from 'react';
import { Info, ExternalLink, X } from 'lucide-react';
import { api } from '../api';
import './VersionInfo.css';

export default function VersionInfo() {
  const [versionData, setVersionData] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen && !versionData) {
      api.getVersion()
        .then(setVersionData)
        .catch((err) => setError(err.message));
    }
  }, [isOpen, versionData]);

  return (
    <>
      <button
        className="version-trigger"
        onClick={() => setIsOpen(true)}
        aria-label="View version info"
        title="Version info"
      >
        <Info size={16} />
      </button>

      {isOpen && (
        <div className="version-modal-backdrop" onClick={() => setIsOpen(false)}>
          <div
            className="version-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="version-modal-title"
          >
            <div className="version-header">
              <h3 id="version-modal-title">LLM Council</h3>
              <button
                className="version-close"
                onClick={() => setIsOpen(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {error ? (
              <div className="version-error">Failed to load version info</div>
            ) : !versionData ? (
              <div className="version-loading">Loading...</div>
            ) : (
              <div className="version-content">
                <div className="version-row">
                  <span className="version-label">Version</span>
                  <span className="version-value">
                    {versionData.release_url ? (
                      <a
                        href={versionData.release_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="version-link"
                      >
                        v{versionData.version}
                        <ExternalLink size={12} />
                      </a>
                    ) : (
                      `v${versionData.version}`
                    )}
                  </span>
                </div>

                <div className="version-row">
                  <span className="version-label">Commit</span>
                  <span className="version-value">
                    {versionData.commit_url ? (
                      <a
                        href={versionData.commit_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="version-link mono"
                      >
                        {versionData.git_commit_short}
                        <ExternalLink size={12} />
                      </a>
                    ) : (
                      <span className="mono">{versionData.git_commit_short}</span>
                    )}
                  </span>
                </div>

                {versionData.build_time && versionData.build_time !== 'unknown' && (
                  <div className="version-row">
                    <span className="version-label">Built</span>
                    <span className="version-value mono">
                      {versionData.build_time}
                    </span>
                  </div>
                )}

                <div className="version-row">
                  <span className="version-label">Source</span>
                  <span className="version-value">
                    <a
                      href={versionData.repo_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="version-link"
                    >
                      GitHub
                      <ExternalLink size={12} />
                    </a>
                  </span>
                </div>
              </div>
            )}

            <div className="version-footer">
              <span>Collaborative LLM Deliberation</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
