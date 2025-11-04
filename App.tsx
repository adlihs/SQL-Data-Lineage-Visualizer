import React, { useState, useCallback } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import type { LineageData, Node } from './types';
import { LineageGraph } from './components/LineageGraph';
import { NodeDetailSidebar } from './components/NodeDetailSidebar';

const App: React.FC = () => {
  const [sqlScript, setSqlScript] = useState<string>(`-- Paste your SQL script here. Example:
WITH customer_details AS (
    SELECT
        c.customer_id,
        c.first_name || ' ' || c.last_name AS full_name,
        c.email,
        a.address,
        ci.city,
        a.postal_code,
        a.phone
    FROM customer c
    JOIN address a ON c.address_id = a.address_id
    JOIN city ci ON a.city_id = ci.city_id
),

payments_by_customer AS (
    SELECT
        customer_id,
        DATE_TRUNC('month', payment_date) as billing_month,
        SUM(amount) as amount
    FROM payment
    GROUP BY 1, 2
)

SELECT
    cd.customer_id,
    cd.full_name,
    cd.email,
    pbc.billing_month,
    pbc.amount
FROM customer_details cd
JOIN payments_by_customer pbc ON cd.customer_id = pbc.customer_id
`);
  const [lineageData, setLineageData] = useState<LineageData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  const generateLineage = useCallback(async () => {
    if (!sqlScript.trim()) {
      setError("SQL script cannot be empty.");
      return;
    }
    
    setIsLoading(true);
    setError(null);
    setLineageData(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

      const lineageSchema = {
        type: Type.OBJECT,
        properties: {
          nodes: {
            type: Type.ARRAY,
            description: "A list of all tables, views, or CTEs found in the SQL.",
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING, description: "Unique identifier for the node, typically the table/CTE name."},
                name: { type: Type.STRING, description: "Display name of the table, view, or CTE." },
                type: { type: Type.STRING, enum: ['Source', 'Table', 'Model', 'View', 'CTE'], description: "The type of the data source." },
                columns: {
                  type: Type.ARRAY,
                  description: "A list of columns within this node.",
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING, description: "The name of the column." },
                      type: { type: Type.STRING, description: "The SQL data type of the column (e.g., VARCHAR, INTEGER, TIMESTAMP). Use 'unknown' if the type cannot be determined." }
                    },
                    required: ['name', 'type'],
                  }
                }
              },
              required: ['id', 'name', 'type', 'columns'],
            }
          },
          edges: {
            type: Type.ARRAY,
            description: "A list of connections representing data flow between columns of different nodes.",
            items: {
              type: Type.OBJECT,
              properties: {
                sourceNodeId: { type: Type.STRING, description: "The ID of the source node for the data flow." },
                sourceColumn: { type: Type.STRING, description: "The name of the source column." },
                targetNodeId: { type: Type.STRING, description: "The ID of the target node for the data flow." },
                targetColumn: { type: Type.STRING, description: "The name of the target column." }
              },
              required: ['sourceNodeId', 'sourceColumn', 'targetNodeId', 'targetColumn'],
            }
          }
        },
        required: ['nodes', 'edges'],
      };

      const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `Your task is to act as an expert SQL analyzer. You will be given a SQL script and you must produce a complete, column-level data lineage graph in a specific JSON format. Follow these steps and rules meticulously.

**Analysis Process (Follow these steps in order):**

**Step 1: Identify ALL Data Entities (These will become your \`nodes\`)**
1.  **Source Tables:** Go through every \`FROM\` and \`JOIN\` clause in the entire script. For each table you find, create a \`Source\` or \`Table\` type node. Use the real table name, not its alias.
2.  **Common Table Expressions (CTEs):** Go through the \`WITH\` clause. For each CTE defined (e.g., \`my_cte AS (...)\`), create a \`CTE\` type node.
3.  **Final Output:** The final \`SELECT\` statement of the script represents the ultimate output. Create a \`Model\` or \`View\` type node for this. You can name it something descriptive like \`final_output\`.

**Step 2: List ALL Columns for Each Node**
*   For each node you identified in Step 1, you must list all columns associated with it within the context of the script.
*   **Column Data Types:** For each column, you MUST determine its SQL data type.
    *   If the script contains DDL (\`CREATE TABLE\`), use the types defined there.
    *   If a column is created using a \`CAST(col AS TYPE)\` or \`::TYPE\` syntax, use that explicit type.
    *   If a type is ambiguous (e.g., from a function like \`NOW()\`), infer a reasonable type (e.g., \`TIMESTAMP\`).
    *   If the type cannot be determined from the context, use the string \`"unknown"\` as the value for the \`type\` field.
*   **Source Tables:** List every column that is selected from it, used in a \`JOIN\`, in a \`WHERE\` clause, or in a function/expression.
*   **CTEs / Final Output:** List every column defined in its \`SELECT\` list along with its data type.

**Step 3: Trace ALL Column-to-Column Dependencies (These will become your \`edges\`)**
*   This is the most critical step. For every column in a CTE or the Final Output node, trace it back to its origin.
*   **Direct Mapping:** If \`new_col\` comes from \`source_col\`, create an edge: \`source_table.source_col -> new_table.new_col\`.
*   **Function/Expression:** If \`new_col\` is derived from an expression like \`SUM(amount)\`, \`DATE_TRUNC(...)\`, or \`first_name || ' ' || last_name\`, create an edge from **each** source column involved in the expression to the \`new_col\`.
    *   Example: For \`full_name AS first_name || ' ' || last_name\`, you must create two edges: \`customer.first_name -> customer_details.full_name\` AND \`customer.last_name -> customer_details.full_name\`.
*   **JOIN Conditions:** For every \`JOIN\` condition like \`ON a.id = b.id\`, create an edge showing the relationship.

**Crucial Rules & Constraints (Your output will be invalid if you ignore these):**

1.  **Node Completeness:** The \`nodes\` list MUST contain an entry for EVERY single source table, CTE, and the final output query. No exceptions. If you see a table in a \`JOIN\`, it MUST be a node.
2.  **Column Completeness:** Every node in the \`nodes\` list MUST have a non-empty \`columns\` array. Each column object MUST have both a \`name\` and a \`type\`.
3.  **Edge Validity:** Every \`sourceNodeId\`, \`targetNodeId\`, \`sourceColumn\`, and \`targetColumn\` in an \`edge\` MUST correspond to a real node and column defined in your \`nodes\` list. You cannot create an edge pointing to or from a non-existent node/column.
4.  **No Dangling Nodes:** Every source table should eventually connect to a CTE or the final output. The graph should be a single, connected component where possible.

Now, analyze the following SQL script and generate the JSON object that strictly follows the schema and all the instructions above.

SQL Script: ${sqlScript}`,
          config: {
            responseMimeType: "application/json",
            responseSchema: lineageSchema,
          },
      });

      const jsonText = response.text.trim();
      const parsedData = JSON.parse(jsonText);
      
      if (!parsedData || !Array.isArray(parsedData.nodes) || !Array.isArray(parsedData.edges)) {
        console.error("Invalid data structure from API:", parsedData);
        throw new Error("Received invalid data structure for lineage graph.");
      }
      
      setLineageData(parsedData as LineageData);

    } catch (e) {
      console.error(e);
      setError("Failed to generate data lineage. Please check your SQL script and API key.");
      setLineageData(null);
    } finally {
      setIsLoading(false);
    }
  }, [sqlScript]);

  const handleNodeClick = useCallback((node: Node) => {
    setSelectedNode(node);
  }, []);

  const handleCloseSidebar = useCallback(() => {
    setSelectedNode(null);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-gray-100 font-sans">
      <header className="bg-white shadow-md p-4 z-10">
        <h1 className="text-2xl font-bold text-gray-800">SQL Data Lineage Visualizer</h1>
        <p className="text-gray-600">Paste your SQL script to automatically generate and visualize its data lineage.</p>
      </header>
      
      <div className="flex flex-grow min-h-0">
        <aside className="w-1/3 min-w-[400px] bg-white p-4 flex flex-col shadow-lg">
          <h2 className="text-lg font-semibold mb-2 text-gray-700">SQL Input</h2>
          <textarea
            value={sqlScript}
            onChange={(e) => setSqlScript(e.target.value)}
            placeholder="Paste your SQL script here..."
            className="flex-grow w-full p-3 border border-gray-300 rounded-md resize-none font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <button
            onClick={generateLineage}
            disabled={isLoading}
            className="mt-4 w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-md hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Generating...
              </>
            ) : "Generate Lineage"}
          </button>
        </aside>

        <main className="flex-grow bg-gray-50 p-4 relative">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/70 z-20">
              <div className="text-center">
                  <div className="text-blue-600 text-2xl font-semibold">Analyzing SQL script...</div>
                  <p className="text-gray-600 mt-2">This may take a moment.</p>
              </div>
            </div>
          )}
          {error && (
             <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-20">
              <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg shadow-md max-w-md text-center" role="alert">
                <strong className="font-bold">An error occurred!</strong>
                <span className="block sm:inline ml-2">{error}</span>
              </div>
            </div>
          )}
          {!isLoading && !lineageData && !error && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-20">
               <div className="text-center text-gray-500">
                <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10s5 2 5 2l2-5s-1 1-4 2-5 3-5 3" />
                </svg>
                <h3 className="mt-2 text-lg font-medium">Data lineage will appear here</h3>
                <p className="mt-1 text-sm">Enter a SQL script and click "Generate Lineage" to start.</p>
              </div>
            </div>
          )}
          {lineageData && <LineageGraph key={JSON.stringify(lineageData)} data={lineageData} onNodeClick={handleNodeClick} />}
          {selectedNode && <NodeDetailSidebar node={selectedNode} onClose={handleCloseSidebar} />}
        </main>
      </div>
    </div>
  );
};

export default App;