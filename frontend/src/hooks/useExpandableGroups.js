import { useState, useCallback, useEffect } from 'react';

/**
 * Hook for managing expand/collapse state of groups (e.g., provider sections).
 *
 * @param {Array<string>} initialExpanded - Groups to expand initially
 * @returns {Object} Expansion state and controls
 */
export function useExpandableGroups(initialExpanded = []) {
  const [expanded, setExpanded] = useState(new Set(initialExpanded));

  /**
   * Toggle a single group's expanded state.
   */
  const toggle = useCallback((group) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  }, []);

  /**
   * Expand specific groups (replaces current expansion state).
   */
  const expandAll = useCallback((groups) => {
    setExpanded(new Set(groups));
  }, []);

  /**
   * Collapse all groups.
   */
  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, []);

  /**
   * Expand groups that match a predicate.
   */
  const expandMatching = useCallback((groups, predicate) => {
    const matching = groups.filter(predicate);
    setExpanded(new Set(matching));
  }, []);

  /**
   * Check if a group is expanded.
   */
  const isExpanded = useCallback((group) => expanded.has(group), [expanded]);

  return {
    expanded,
    isExpanded,
    toggle,
    expandAll,
    collapseAll,
    expandMatching,
    expandedCount: expanded.size,
  };
}

/**
 * Hook that auto-expands groups based on search or selection.
 * Extends useExpandableGroups with automatic expansion behavior.
 *
 * @param {Object} options - Configuration options
 * @param {Array<string>} options.allGroups - All available group names
 * @param {string} options.searchQuery - Current search query
 * @param {Set|Array} options.selectedIds - Currently selected item IDs
 * @param {Array} options.items - All items (for finding groups of selected items)
 * @param {Function} options.getItemGroup - Function to get group from item
 * @returns {Object} Expansion state and controls
 */
export function useAutoExpandableGroups({
  allGroups = [],
  searchQuery = '',
  selectedIds = new Set(),
  items = [],
  getItemGroup = (item) => item.provider || 'Other',
}) {
  const base = useExpandableGroups();
  const { expandAll, expandMatching } = base;

  // Auto-expand all when searching
  useEffect(() => {
    if (searchQuery) {
      expandAll(allGroups);
    }
  }, [searchQuery, allGroups, expandAll]);

  // Initially expand groups with selected items
  useEffect(() => {
    if (items.length > 0 && base.expandedCount === 0) {
      const selectedSet =
        selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
      const groupsWithSelected = new Set();

      items.forEach((item) => {
        if (selectedSet.has(item.id)) {
          groupsWithSelected.add(getItemGroup(item));
        }
      });

      if (groupsWithSelected.size > 0) {
        expandAll(Array.from(groupsWithSelected));
      }
    }
  }, [items, selectedIds, getItemGroup, expandAll, base.expandedCount]);

  return base;
}
