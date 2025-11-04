
export interface Column {
  name: string;
  type: string;
}

export enum NodeType {
  Source = 'Source',
  Table = 'Table',
  Model = 'Model',
  View = 'View',
  CTE = 'CTE',
}

export interface Node {
  id: string;
  name: string;
  type: NodeType;
  columns: Column[];
}

export interface Edge {
  sourceNodeId: string;
  sourceColumn: string;
  targetNodeId: string;
  targetColumn: string;
}

export interface LineageData {
  nodes: Node[];
  edges: Edge[];
}

export interface D3Node extends Node {
    x?: number;
    y?: number;
    fx?: number | null;
    fy?: number | null;
}