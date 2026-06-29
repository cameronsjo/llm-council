import { useState, useRef, useEffect } from 'react';
import { Pencil, Trash2, Download } from 'lucide-react';
import { useSeatColors } from '../../hooks/useSeatColors';

/**
 * Format a creation timestamp as a relative-time string: "3m ago", "2h ago", "4d ago".
 */
function formatRelativeTime(iso) {
  if (!iso) return '';
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return '';
  }
}

/**
 * Single conversation item with rename/delete/export functionality.
 * Row layout: seat dot + title on line 1; mode · relative-time on line 2.
 */
export function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onRename,
  onDelete,
  onExport,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editingTitle, setEditingTitle] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const inputRef = useRef(null);
  const exportMenuRef = useRef(null);
  const { seatOf } = useSeatColors();

  // Derive a stable seat color: prefer conversation's model info, fall back to conversation id.
  const modelId =
    conversation.chairman_model ?? conversation.council_models?.[0] ?? conversation.id;
  const seat = seatOf(modelId);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Close export menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) {
        setShowExportMenu(false);
      }
    };
    if (showExportMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showExportMenu]);

  const handleStartRename = (e) => {
    e.stopPropagation();
    setEditingTitle(conversation.title || 'New Conversation');
    setIsEditing(true);
  };

  const handleFinishRename = async () => {
    if (editingTitle.trim()) {
      await onRename(conversation.id, editingTitle.trim());
    }
    setIsEditing(false);
    setEditingTitle('');
  };

  const handleCancelRename = () => {
    setIsEditing(false);
    setEditingTitle('');
  };

  const handleRenameKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleFinishRename();
    } else if (e.key === 'Escape') {
      handleCancelRename();
    }
  };

  const handleDeleteClick = (e) => {
    e.stopPropagation();
    setIsDeleting(true);
  };

  const handleConfirmDelete = async (e) => {
    e.stopPropagation();
    await onDelete(conversation.id);
    setIsDeleting(false);
  };

  const handleCancelDelete = (e) => {
    e.stopPropagation();
    setIsDeleting(false);
  };

  const handleExportClick = (e) => {
    e.stopPropagation();
    setShowExportMenu(!showExportMenu);
  };

  const handleExport = async (format) => {
    setShowExportMenu(false);
    if (onExport) {
      await onExport(conversation.id, format);
    }
  };

  const handleClick = () => {
    if (!isEditing) {
      onSelect(conversation.id);
    }
  };

  // Delete confirmation state
  if (isDeleting) {
    return (
      <div className={`conversation-item ${isActive ? 'active' : ''} deleting`}>
        <div className="delete-confirm">
          <span className="delete-confirm-text">Delete?</span>
          <div className="delete-confirm-actions">
            <button
              className="confirm-btn confirm-yes"
              onClick={handleConfirmDelete}
              title="Confirm delete"
            >
              Yes
            </button>
            <button className="confirm-btn confirm-no" onClick={handleCancelDelete} title="Cancel">
              No
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Editing state
  if (isEditing) {
    return (
      <div className={`conversation-item ${isActive ? 'active' : ''}`}>
        <input
          ref={inputRef}
          type="text"
          className="rename-input"
          value={editingTitle}
          onChange={(e) => setEditingTitle(e.target.value)}
          onKeyDown={handleRenameKeyDown}
          onBlur={handleFinishRename}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    );
  }

  // Default state — two-line row
  return (
    <div className={`conversation-item ${isActive ? 'active' : ''}`} onClick={handleClick}>
      <div className="conversation-content">
        <div className="conversation-row-1">
          <span
            className="conversation-seat-dot"
            style={{ background: seat.color }}
            aria-hidden="true"
          />
          <span className="conversation-title">{conversation.title || 'New Conversation'}</span>
        </div>
        <div className="conversation-row-2">
          {conversation.mode ? (
            <>
              <span className="conversation-mode">{conversation.mode}</span>
              <span className="conversation-sep" aria-hidden="true">
                ·
              </span>
            </>
          ) : null}
          <span className="conversation-time">{formatRelativeTime(conversation.created_at)}</span>
        </div>
      </div>
      <div className="conversation-actions">
        <button className="action-btn" onClick={handleStartRename} title="Rename">
          <Pencil size={13} />
        </button>
        <div className="export-menu-container" ref={exportMenuRef}>
          <button className="action-btn" onClick={handleExportClick} title="Export">
            <Download size={13} />
          </button>
          {showExportMenu && (
            <div className="export-menu">
              <button className="export-menu-item" onClick={() => handleExport('markdown')}>
                Export as Markdown
              </button>
              <button className="export-menu-item" onClick={() => handleExport('json')}>
                Export as JSON
              </button>
            </div>
          )}
        </div>
        <button className="action-btn action-delete" onClick={handleDeleteClick} title="Delete">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
