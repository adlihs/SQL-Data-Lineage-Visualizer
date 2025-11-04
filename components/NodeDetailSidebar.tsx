import React from 'react';
import type { Node } from '../types';
import { NodeType } from '../types';
import { DBTIcon, PostgreSQLIcon } from './icons';

interface NodeDetailSidebarProps {
  node: Node;
  onClose: () => void;
}

const ICONS: { [key in NodeType]?: React.FC<{className: string}> } = {
    [NodeType.Source]: PostgreSQLIcon,
    [NodeType.Table]: PostgreSQLIcon,
    [NodeType.Model]: DBTIcon,
    [NodeType.View]: DBTIcon,
    [NodeType.CTE]: DBTIcon,
};

export const NodeDetailSidebar: React.FC<NodeDetailSidebarProps> = ({ node, onClose }) => {
  const Icon = ICONS[node.type];

  // Prevent click propagation from sidebar to backdrop
  const handleSidebarClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/20 z-30"
        onClick={onClose}
        aria-hidden="true"
      ></div>

      {/* Sidebar */}
      <aside 
        className="absolute top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl z-40 flex flex-col"
        onClick={handleSidebarClick}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sidebar-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 flex-shrink-0">
            <div className="flex items-center gap-3 min-w-0">
                {Icon && <Icon className="w-8 h-8 flex-shrink-0" />}
                <div className="min-w-0">
                    <h2 id="sidebar-title" className="text-xl font-bold text-gray-800 truncate" title={node.name}>{node.name}</h2>
                    <p className="text-sm text-gray-500">{node.type}</p>
                </div>
            </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            aria-label="Close details panel"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Column List */}
        <div className="flex-grow overflow-y-auto p-4">
          <h3 className="text-lg font-semibold text-gray-700 mb-3">Columns</h3>
          <ul className="divide-y divide-gray-200">
            {node.columns.map((col) => (
              <li key={col.name} className="py-3 flex justify-between items-baseline">
                <span className="text-gray-800 font-medium break-all pr-4">{col.name}</span>
                <span className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-1 rounded-md flex-shrink-0 ml-4">{col.type.toUpperCase()}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </>
  );
};