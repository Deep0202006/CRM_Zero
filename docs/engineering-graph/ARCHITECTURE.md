# CRM Engineering Graph architecture

The controller separates:

- **Normative knowledge** — what CRM must mean.
- **Observed implementation** — what code/schema currently do.
- **Proof** — what has been verified at an exact SHA/environment.
- **Execution state** — what engineering task/node is legal next.

Codex is a worker node. LangGraph owns durable execution state and transitions.
The CRM product does not import the engineering graph.

Logical graphs:
1. repository graph;
2. domain authority graph;
3. impact graph;
4. proof graph;
5. lessons→rules graph;
6. execution graph.

The first four are repository knowledge structures. The sixth is the LangGraph
workflow. Do not force all knowledge into LangGraph state.
