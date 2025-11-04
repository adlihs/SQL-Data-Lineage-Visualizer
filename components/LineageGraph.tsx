import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import type { LineageData, D3Node, Node, Edge } from '../types';
import { NodeType } from '../types';
import { DBTIcon, PostgreSQLIcon } from './icons';

interface NodeComponentProps {
    node: D3Node;
    onNodeClick: (node: Node) => void;
    onNodeDrag: (nodeId: string, position: { x: number; y: number }) => void;
}

const ICONS: { [key in NodeType]?: React.FC<{className: string}> } = {
    [NodeType.Source]: PostgreSQLIcon,
    [NodeType.Table]: PostgreSQLIcon,
    [NodeType.Model]: DBTIcon,
    [NodeType.View]: DBTIcon,
    [NodeType.CTE]: DBTIcon,
};

const NODE_WIDTH = 256;
const HEADER_HEIGHT = 60;
const COLUMN_HEIGHT = 28;

const NodeComponent: React.FC<NodeComponentProps> = ({ node, onNodeClick, onNodeDrag }) => {
    const nodeRef = useRef<HTMLDivElement>(null);
    // Ref to hold the current node state to avoid stale closures in drag handler
    const currentNodeRef = useRef(node);
    currentNodeRef.current = node;

    const Icon = ICONS[node.type];
    const nodeHeight = HEADER_HEIGHT + (node.columns.length * COLUMN_HEIGHT);

    useEffect(() => {
        if (!nodeRef.current) return;

        const selection = d3.select(nodeRef.current);
        const dragHandler = d3.drag<HTMLDivElement, unknown>()
            .on('start', function(event) {
                // Prevent click from firing on drag end
                event.sourceEvent.stopPropagation();
                d3.select(this).style('cursor', 'grabbing');
            })
            .on('drag', function(event) {
                const latestNode = currentNodeRef.current;
                const newPosition = {
                    x: (latestNode.x || 0) + event.dx,
                    y: (latestNode.y || 0) + event.dy,
                };
                onNodeDrag(latestNode.id, newPosition);
            })
            .on('end', function() {
                d3.select(this).style('cursor', 'grab');
            });
        
        selection.call(dragHandler);

        return () => {
            selection.on('.drag', null);
        };
    }, [onNodeDrag]); // Effect depends on onNodeDrag, which is stable due to useCallback

    return (
        <div
            ref={nodeRef}
            id={`node-${node.id}`}
            className="absolute bg-white border border-gray-200 rounded-lg shadow-lg cursor-grab"
            style={{ 
                width: `${NODE_WIDTH}px`,
                left: `${node.x ?? 0}px`, 
                top: `${node.y ?? 0}px`,
                transform: `translate(-${NODE_WIDTH / 2}px, -${nodeHeight / 2}px)`,
            }}
            onClick={(e) => {
                if (e.defaultPrevented) return; // Legacy check, though d3 v6+ uses sourceEvent.stopPropagation()
                onNodeClick(node);
            }}
        >
            <div 
                className="px-4 py-3 border-b border-gray-200"
            >
                <div className="flex items-center gap-3">
                    {Icon && <Icon className="w-6 h-6" />}
                    <div>
                        <p className="font-bold text-gray-800 truncate">{node.name}</p>
                        <p className="text-xs text-gray-500">{node.type}</p>
                    </div>
                </div>
            </div>
            <ul className="py-2">
                {node.columns.map((col) => {
                    return (
                        <li 
                            key={col.name}
                            id={`col-${node.id}-${col.name}`}
                            className={`px-4 py-1 text-sm text-gray-700 relative`}
                            style={{ height: `${COLUMN_HEIGHT}px` }}
                        >
                            <span>{col.name}</span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};


interface LineageGraphProps {
    data: LineageData;
    onNodeClick: (node: Node) => void;
}

export const LineageGraph: React.FC<LineageGraphProps> = ({ data, onNodeClick }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const captureRef = useRef<HTMLDivElement>(null);
    const [nodes, setNodes] = useState<D3Node[]>([]);
    const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
    const [isExporting, setIsExporting] = useState(false);
    const [showExportMenu, setShowExportMenu] = useState(false);
    
    const handleNodeDrag = useCallback((nodeId: string, position: { x: number; y: number }) => {
        setNodes(currentNodes =>
            currentNodes.map(n =>
                n.id === nodeId ? { ...n, x: position.x, y: position.y, fx: position.x, fy: position.y } : n
            )
        );
    }, []);
    
    const nodeMap = useMemo(() => {
        return new Map(nodes.map(n => [n.id, n]));
    }, [nodes]);
    
    const nodeDepths = useMemo(() => {
        if (!data || !data.nodes.length) return new Map<string, number>();

        const nodeOrder = new Map<string, number>();
        data.nodes.forEach((node, index) => nodeOrder.set(node.id, index));

        // 1. Find connected components using an undirected graph representation
        const adj = new Map<string, string[]>();
        data.nodes.forEach(node => adj.set(node.id, []));
        data.edges.forEach(edge => {
            adj.get(edge.sourceNodeId)?.push(edge.targetNodeId);
            adj.get(edge.targetNodeId)?.push(edge.sourceNodeId);
        });

        const visited = new Set<string>();
        const components: Node[][] = [];
        for (const startNode of data.nodes) {
            if (!visited.has(startNode.id)) {
                const component: Node[] = [];
                const queue = [startNode];
                visited.add(startNode.id);
                let head = 0;
                while (head < queue.length) {
                    const uNode = queue[head++];
                    component.push(uNode);
                    for (const vId of adj.get(uNode.id) || []) {
                        if (!visited.has(vId)) {
                            visited.add(vId);
                            const vNode = data.nodes.find(n => n.id === vId);
                            if (vNode) queue.push(vNode);
                        }
                    }
                }
                components.push(component);
            }
        }

        // 2. Order components based on the script appearance of their first node
        components.sort((compA, compB) => {
            const minOrderA = Math.min(...compA.map(node => nodeOrder.get(node.id)!));
            const minOrderB = Math.min(...compB.map(node => nodeOrder.get(node.id)!));
            return minOrderA - minOrderB;
        });

        // 3. Calculate depths for each component and apply an offset for horizontal layout
        const finalDepths = new Map<string, number>();
        let depthOffset = 0;

        for (const component of components) {
            const componentNodeIds = new Set(component.map(n => n.id));
            const componentEdges = data.edges.filter(e =>
                componentNodeIds.has(e.sourceNodeId) && componentNodeIds.has(e.targetNodeId)
            );

            // Calculate depths within this component using topological sort
            const depths = new Map<string, number>();
            const inDegree = new Map<string, number>();
            const compAdj = new Map<string, string[]>();

            component.forEach(node => {
                inDegree.set(node.id, 0);
                compAdj.set(node.id, []);
            });

            componentEdges.forEach(edge => {
                inDegree.set(edge.targetNodeId, (inDegree.get(edge.targetNodeId) || 0) + 1);
                compAdj.get(edge.sourceNodeId)?.push(edge.targetNodeId);
            });

            const queue: string[] = [];
            component.forEach(node => {
                if ((inDegree.get(node.id) || 0) === 0) {
                    queue.push(node.id);
                    depths.set(node.id, 0);
                }
            });
            queue.sort((a,b) => (nodeOrder.get(a) || 0) - (nodeOrder.get(b) || 0));

            let head = 0;
            while (head < queue.length) {
                const u = queue[head++];
                const u_depth = depths.get(u)!;
                const neighbors = compAdj.get(u) || [];
                neighbors.sort((a,b) => (nodeOrder.get(a) || 0) - (nodeOrder.get(b) || 0));

                for (const v of neighbors) {
                    depths.set(v, Math.max(depths.get(v) || 0, u_depth + 1));
                    const newDegree = (inDegree.get(v)!) - 1;
                    inDegree.set(v, newDegree);
                    if (newDegree === 0) {
                        queue.push(v);
                    }
                }
            }
            
            let maxDepthInComponent = 0;
            component.forEach(node => {
                if (!depths.has(node.id)) depths.set(node.id, 0); // Handle cycles
                
                const nodeDepth = depths.get(node.id)!;
                finalDepths.set(node.id, nodeDepth + depthOffset);
                if (nodeDepth > maxDepthInComponent) maxDepthInComponent = nodeDepth;
            });

            depthOffset += maxDepthInComponent + 2; // Add space between components
        }

        return finalDepths;
    }, [data]);

    useEffect(() => {
        if (!containerRef.current || !data.nodes.length) return;
        
        const nodeOrder = new Map<string, number>();
        data.nodes.forEach((node, index) => {
            nodeOrder.set(node.id, index);
        });

        const height = containerRef.current.clientHeight;
        const xSpacing = NODE_WIDTH + 120; // Increased spacing
        
        const initialNodes: D3Node[] = JSON.parse(JSON.stringify(data.nodes));

        // Group nodes by depth column
        const nodesByDepth: { [depth: number]: D3Node[] } = {};
        initialNodes.forEach(node => {
            const depth = nodeDepths.get(node.id) ?? 0;
            if (!nodesByDepth[depth]) {
                nodesByDepth[depth] = [];
            }
            nodesByDepth[depth].push(node);
        });

        // For each depth level, sort nodes by their original order and calculate Y positions
        Object.values(nodesByDepth).forEach(nodesInDepth => {
            nodesInDepth.sort((a, b) => (nodeOrder.get(a.id) ?? 0) - (nodeOrder.get(b.id) ?? 0));

            const totalContentHeight = nodesInDepth.reduce((acc, node) => {
                const nodeHeight = HEADER_HEIGHT + (node.columns.length * COLUMN_HEIGHT);
                return acc + nodeHeight;
            }, 0);
            
            const verticalMargin = 40;
            const totalMargin = (nodesInDepth.length - 1) * verticalMargin;
            const totalColumnHeight = totalContentHeight + totalMargin;
            let currentY = (height - totalColumnHeight) / 2;

            nodesInDepth.forEach(node => {
                const nodeHeight = HEADER_HEIGHT + (node.columns.length * COLUMN_HEIGHT);
                node.y = currentY + (nodeHeight / 2); // set y to the center of the node's vertical slot
                currentY += nodeHeight + verticalMargin;
            });
        });
        
        initialNodes.forEach(node => {
            const depth = nodeDepths.get(node.id) ?? 0;
            node.x = (depth * xSpacing) + 50 + (NODE_WIDTH / 2);
        });
        
        // Find bounds and apply offset to ensure all coordinates are positive
        if (initialNodes.length > 0) {
            let minX = Infinity;
            let minY = Infinity;

            initialNodes.forEach(node => {
                const nodeHeight = HEADER_HEIGHT + (node.columns.length * COLUMN_HEIGHT);
                const nodeLeft = (node.x ?? 0) - (NODE_WIDTH / 2);
                const nodeTop = (node.y ?? 0) - (nodeHeight / 2);

                if (nodeLeft < minX) minX = nodeLeft;
                if (nodeTop < minY) minY = nodeTop;
            });

            const padding = 50;
            const offsetX = minX < padding ? -minX + padding : 0;
            const offsetY = minY < padding ? -minY + padding : 0;

            if (offsetX > 0 || offsetY > 0) {
                initialNodes.forEach(node => {
                    node.x = (node.x ?? 0) + offsetX;
                    node.y = (node.y ?? 0) + offsetY;
                });
            }
        }
        
        setNodes(initialNodes);
        
        // Reset scroll position after layout calculation
        if (containerRef.current) {
            containerRef.current.scrollTop = 0;
            containerRef.current.scrollLeft = 0;
        }

    }, [data, nodeDepths]);
    
    const getColumnYOffset = useCallback((nodeId: string, columnName: string): number => {
        const node = nodeMap.get(nodeId);
        if (!node) return 0;
        const columnIndex = node.columns.findIndex(c => c.name === columnName);
        if (columnIndex === -1) return 0;
        return HEADER_HEIGHT + (columnIndex * COLUMN_HEIGHT) + (COLUMN_HEIGHT / 2);
    }, [nodeMap]);

    const graphDimensions = useMemo(() => {
        if (!nodes.length || !containerRef.current) {
            return { width: '100%', height: '100%' };
        }

        let maxX = 0;
        let maxY = 0;

        nodes.forEach(node => {
            const nodeHeight = HEADER_HEIGHT + (node.columns.length * COLUMN_HEIGHT);
            if (node.x !== undefined && node.y !== undefined) {
                maxX = Math.max(maxX, node.x + NODE_WIDTH / 2);
                maxY = Math.max(maxY, node.y + nodeHeight / 2);
            }
        });

        const padding = 50;
        const containerWidth = containerRef.current.clientWidth;
        const containerHeight = containerRef.current.clientHeight;

        return { 
            width: Math.max(containerWidth, maxX + padding), 
            height: Math.max(containerHeight, maxY + padding)
        };
    }, [nodes]);

    const handleClearSelection = useCallback(() => {
        setSelectedEdge(null);
        setShowExportMenu(false);
    }, []);

    const handleExport = useCallback(async (format: 'png' | 'pdf') => {
        if (!captureRef.current || isExporting) return;
    
        setIsExporting(true);
        setShowExportMenu(false);
    
        // Give a brief moment for the UI to update (e.g., hide the menu)
        await new Promise(resolve => setTimeout(resolve, 100));
    
        try {
            const canvas = await html2canvas(captureRef.current, {
                useCORS: true,
                scale: 2, // for better resolution
                logging: false,
            });
            
            if (format === 'png') {
                const image = canvas.toDataURL('image/png', 1.0);
                const link = document.createElement('a');
                link.href = image;
                link.download = 'data-lineage.png';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            } else if (format === 'pdf') {
                const imgData = canvas.toDataURL('image/jpeg', 0.9);
                const pdf = new jsPDF({
                    orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
                    unit: 'px',
                    format: [canvas.width, canvas.height],
                    hotfixes: ['px_scaling'],
                });
                pdf.addImage(imgData, 'JPEG', 0, 0, canvas.width, canvas.height);
                pdf.save('data-lineage.pdf');
            }
        } catch (error) {
            console.error("Export failed:", error);
            alert("Sorry, the export failed. Please try again.");
        } finally {
            setIsExporting(false);
        }
    }, [isExporting]);

    const getEdgeStyle = useCallback((currentEdge: Edge): { stroke: string; strokeWidth: number; opacity: number; isRelated: boolean; } => {
        if (!selectedEdge) {
            return { stroke: '#9ca3af', strokeWidth: 1.5, opacity: 1, isRelated: false };
        }
        
        const isRelatedToSelection =
            (currentEdge.sourceNodeId === selectedEdge.sourceNodeId && currentEdge.sourceColumn === selectedEdge.sourceColumn) ||
            (currentEdge.targetNodeId === selectedEdge.targetNodeId && currentEdge.targetColumn === selectedEdge.targetColumn);

        if (isRelatedToSelection) {
            return { stroke: '#2563eb', strokeWidth: 2.5, opacity: 1, isRelated: true };
        } else {
            return { stroke: '#d1d5db', strokeWidth: 1, opacity: 0.6, isRelated: false };
        }
    }, [selectedEdge]);

    return (
        <div ref={containerRef} className="w-full h-full relative overflow-auto" onClick={handleClearSelection}>
            <div
                ref={captureRef}
                className="relative bg-dots"
                style={{ width: graphDimensions.width, height: graphDimensions.height }}
            >
                <svg width={graphDimensions.width} height={graphDimensions.height} className="absolute top-0 left-0">
                    <defs>
                        <marker
                            id="arrowhead"
                            viewBox="-0 -5 10 10"
                            refX="5"
                            refY="0"
                            orient="auto"
                            markerWidth="8"
                            markerHeight="8"
                            xoverflow="visible">
                            <path d="M 0,-5 L 10 ,0 L 0,5" fill="#9ca3af" strokeLinejoin="round"></path>
                        </marker>
                        <marker
                            id="arrowhead-active"
                            viewBox="-0 -5 10 10"
                            refX="5"
                            refY="0"
                            orient="auto"
                            markerWidth="8"
                            markerHeight="8"
                            xoverflow="visible">
                            <path d="M 0,-5 L 10 ,0 L 0,5" fill="#2563eb" strokeLinejoin="round"></path>
                        </marker>
                    </defs>
                    <g>
                        {data.edges.map((edge, i) => {
                            const sourceNode = nodeMap.get(edge.sourceNodeId);
                            const targetNode = nodeMap.get(edge.targetNodeId);
                            
                            if (!sourceNode || !targetNode || sourceNode.x === undefined || sourceNode.y === undefined || targetNode.x === undefined || targetNode.y === undefined) {
                                return null;
                            }

                            const sourceNodeHeight = HEADER_HEIGHT + (sourceNode.columns.length * COLUMN_HEIGHT);
                            const targetNodeHeight = HEADER_HEIGHT + (targetNode.columns.length * COLUMN_HEIGHT);

                            const y1 = (sourceNode.y - sourceNodeHeight / 2) + getColumnYOffset(edge.sourceNodeId, edge.sourceColumn);
                            const y2 = (targetNode.y - targetNodeHeight / 2) + getColumnYOffset(edge.targetNodeId, edge.targetColumn);
                            
                            let x1, x2;
                            const markerOffset = 10;
                            if (sourceNode.x < targetNode.x) {
                                x1 = sourceNode.x + NODE_WIDTH / 2;
                                x2 = targetNode.x - NODE_WIDTH / 2 - markerOffset;
                            } else {
                                x1 = sourceNode.x - NODE_WIDTH / 2;
                                x2 = targetNode.x + NODE_WIDTH / 2 + markerOffset;
                            }

                            const path = d3.linkHorizontal()({
                                source: [x1, y1],
                                target: [x2, y2]
                            });
                            
                            const style = getEdgeStyle(edge);
                            
                            return (
                               <path
                                    key={`${edge.sourceNodeId}-${edge.sourceColumn}-${edge.targetNodeId}-${edge.targetColumn}-${i}`}
                                    d={path || ''}
                                    fill="none"
                                    stroke={style.stroke}
                                    strokeWidth={style.strokeWidth}
                                    markerEnd={style.isRelated ? 'url(#arrowhead-active)' : 'url(#arrowhead)'}
                                    style={{
                                        opacity: style.opacity,
                                        transition: 'stroke 0.2s, stroke-width 0.2s, opacity 0.2s',
                                        cursor: 'pointer',
                                    }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedEdge(edge);
                                    }}
                                />
                            );
                        })}
                    </g>
                </svg>
                {nodes.map(node => (
                    <NodeComponent 
                        key={node.id} 
                        node={node} 
                        onNodeClick={onNodeClick}
                        onNodeDrag={handleNodeDrag}
                    />
                ))}
            </div>

             {/* Export Controls */}
            <div className="absolute top-4 right-4 z-10">
                <div className="relative" onClick={(e) => e.stopPropagation()}>
                    <button
                        onClick={() => setShowExportMenu(!showExportMenu)}
                        disabled={isExporting || !data.nodes.length}
                        className="bg-white text-gray-700 font-semibold py-2 px-4 border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 disabled:bg-gray-200 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                        aria-haspopup="true"
                        aria-expanded={showExportMenu}
                    >
                        {isExporting ? (
                             <>
                                <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-gray-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Exporting...
                            </>
                        ) : (
                            <>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                Export
                            </>
                        )}
                    </button>
                    {showExportMenu && (
                        <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 ring-1 ring-black ring-opacity-5" role="menu">
                            <button onClick={() => handleExport('png')} className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100" role="menuitem">Export as PNG</button>
                            <button onClick={() => handleExport('pdf')} className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100" role="menuitem">Export as PDF</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};