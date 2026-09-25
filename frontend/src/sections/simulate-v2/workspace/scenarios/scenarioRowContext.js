import { createContext } from "react";

/* What every scenario row is checked against — its status and the tools it
   needs — computed once by the Scenarios tab and read by each table, however
   deep in the batch and group structure it sits. */
export const ScenarioRowContext = createContext({ statusOf: null, toolsOf: null, answers: null });
