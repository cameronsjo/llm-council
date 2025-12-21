import { useState, useRef, useEffect } from 'react';
import { Pencil, Trash2 } from 'lucide-react';

/**
 * Single conversation item with rename/delete functionality.
 */
export function ConversationItem({
  conversation,
  isActive,
  onSelect,
  onRename,
  onDelete,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editingTitle, setEditingTitle] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

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
            <button
              className="confirm-btn confirm-no"
              onClick={handleCancelDelete}
              title="Cancel"
            >
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

  // Default state
  return (
    <div
      className={`conversation-item ${isActive ? 'active' : ''}`}
      onClick={handleClick}
    >
      <div className="conversation-content">
        <div className="conversation-title">
          {conversation.title || 'New Conversation'}
        </div>
        <div className="conversation-meta">
          {conversation.message_count} messages
        </div>
      </div>
      <div className="conversation-actions">
        <button
          className="action-btn"
          onClick={handleStartRename}
          title="Rename"
        >
          <Pencil size={14} />
        </button>
        <button
          className="action-btn action-delete"
          onClick={handleDeleteClick}
          title="Delete"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
