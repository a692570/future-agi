import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, userEvent, waitFor } from "src/utils/test-utils";

import SavedEvalsList from "../SavedEvalsList";

const evalRow = (id, name) => ({
  id,
  name,
  eval_type: "llm",
  template_name: name,
  mapping: { output: "model_output" },
  eval_required_keys: ["output"],
});

const list = ({ evals, autoSelectedNames }) => (
  <SavedEvalsList
    evals={evals}
    autoSelectedNames={autoSelectedNames}
    onDeleteEvalClick={vi.fn()}
    onRunEvalClick={vi.fn()}
    onStopEvalClick={vi.fn()}
    onEditEvalClick={vi.fn()}
    allColumns={[]}
  />
);

const renderList = (props) => render(list(props));

// The first checkbox is the header select-all; row checkboxes follow in
// `evals` order.
const rowCheckboxes = () => screen.getAllByRole("checkbox").slice(1);

describe("SavedEvalsList — auto-select of newly added evals", () => {
  it("checks a newly added eval once its row arrives in the list", async () => {
    // The drawer records the name on save, but the row only appears after the
    // grid refresh, so the effect has to fire on the later `evals` change.
    const { rerender } = renderList({
      evals: [],
      autoSelectedNames: new Set(["toxicity"]),
    });

    rerender(
      list({
        evals: [evalRow("e1", "toxicity")],
        autoSelectedNames: new Set(["toxicity"]),
      }),
    );

    await waitFor(() => {
      expect(rowCheckboxes()[0]).toBeChecked();
    });
    expect(screen.getByText("1 of 1 selected")).toBeInTheDocument();
  });

  it("leaves evals the user never added unchecked", () => {
    renderList({
      evals: [evalRow("e1", "toxicity"), evalRow("e2", "groundedness")],
      autoSelectedNames: new Set(["toxicity"]),
    });

    const [first, second] = rowCheckboxes();
    expect(first).toBeChecked();
    expect(second).not.toBeChecked();
  });

  it("keeps a manual uncheck when a later eval is added", async () => {
    const user = userEvent.setup();
    const { rerender } = renderList({
      evals: [evalRow("e1", "toxicity")],
      autoSelectedNames: new Set(["toxicity"]),
    });

    await waitFor(() => expect(rowCheckboxes()[0]).toBeChecked());

    // User deliberately deselects the auto-selected eval.
    await user.click(rowCheckboxes()[0]);
    expect(rowCheckboxes()[0]).not.toBeChecked();

    // A second eval is added. Only the new one should get checked — the
    // `processedRef` guard is what stops the first from being re-selected.
    rerender(
      list({
        evals: [evalRow("e1", "toxicity"), evalRow("e2", "groundedness")],
        autoSelectedNames: new Set(["toxicity", "groundedness"]),
      }),
    );

    await waitFor(() => {
      expect(rowCheckboxes()[1]).toBeChecked();
    });
    expect(rowCheckboxes()[0]).not.toBeChecked();
    expect(screen.getByText("1 of 2 selected")).toBeInTheDocument();
  });

  it("selects nothing when no eval has been added in this session", () => {
    renderList({
      evals: [evalRow("e1", "toxicity")],
      autoSelectedNames: new Set(),
    });

    expect(rowCheckboxes()[0]).not.toBeChecked();
    expect(screen.getByText("Evals (1)")).toBeInTheDocument();
  });
});
