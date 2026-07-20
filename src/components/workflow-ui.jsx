export function ProjectWorkflowOverview({ overview, nextDisabled, onRunNext, onStepSelect, selectedStepId }) {
  const nextAction = overview.nextAction;
  return (
    <section className="workflow-overview" aria-label="项目进度总览">
      <div className="overview-copy">
        <p className="eyebrow">项目进度</p>
        <h2>{overview.headline}</h2>
        <p>{overview.detail}</p>
        <div className="overview-meter" aria-label={`主流程完成 ${overview.percent}%`}>
          <span style={{ width: `${overview.percent}%` }} />
        </div>
        <small>
          已完成 {overview.completedCount} / {overview.totalCount} 个主阶段
        </small>
      </div>
      <div className="overview-action">
        {nextAction ? (
          <button
            className="primary-button overview-next-button"
            disabled={nextDisabled || nextAction.disabled}
            type="button"
            onClick={onRunNext}
          >
            {nextAction.label}
          </button>
        ) : (
          <strong className="overview-complete">主流程已完成</strong>
        )}
      </div>
      <ol className="overview-steps">
        {overview.steps.map((step) => (
          <li
            key={step.id}
            className={`overview-step ${step.state} ${selectedStepId === (step.panelId || step.id) ? "active" : ""}`}
          >
            <button type="button" onClick={() => onStepSelect(step.panelId || step.id)}>
              <span className="overview-step-index">{String(step.index).padStart(2, "0")}</span>
              <span>
                <strong>{step.title}</strong>
                <small>{step.label}</small>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function WorkflowStageSection({ group, children }) {
  return (
    <section className={`workflow-stage workflow-stage-${group.id}`} aria-labelledby={`stage-${group.id}`}>
      <header className="workflow-stage-heading">
        <p className="eyebrow">{group.eyebrow}</p>
        <h2 id={`stage-${group.id}`}>{group.title}</h2>
        <p>{group.description}</p>
      </header>
      <div className="workflow-stage-grid">{children}</div>
    </section>
  );
}

export function CancelTaskButton({ visible, busy, onClick }) {
  if (!visible) {
    return null;
  }
  return (
    <button
      className="secondary-button workflow-cancel-action"
      disabled={busy}
      type="button"
      onClick={onClick}
    >
      {busy ? "正在取消..." : "取消任务"}
    </button>
  );
}
