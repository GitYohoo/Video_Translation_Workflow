import { formatSize } from "../format.js";
import { ProjectWorkflowOverview } from "./workflow-ui.jsx";

export function VideoProjectHeader({ model, actions }) {
  const {
    isReplacingSource,
    overviewActionDisabledById,
    projectWorkflowRunning,
    record,
    sourceDisplayName,
    sourceReplaceMessage,
    workflowOverview,
  } = model;
  const {
    replaceProjectSource,
    runOverviewNext,
    scrollToWorkflowStep,
  } = actions;

  return (
<>
          <header className="detail-header">
            <div>
              <p className="eyebrow">视频项目</p>
              <h1>{record.name}</h1>
              <p className="file-meta">
                {formatSize(record.size)} · {record.type || "视频文件"} ·
                {record.storageMode === "reference" ? " 原路径引用" : " 旧版复制记录"}
              </p>
              <p
                className={`project-path ${record.sourcePath ? "" : "warning"}`}
                title={record.sourcePath || sourceDisplayName}
              >
                原视频：{sourceDisplayName}
              </p>
            </div>
            <div className="detail-header-actions">
              <span className={`phase-tag ${record.storageMode === "reference" ? "" : "warning"}`}>
                {record.storageMode === "reference" ? "原路径已记录" : "待重新选择原视频"}
              </span>
              <button
                className="secondary-button compact"
                disabled={isReplacingSource || projectWorkflowRunning}
                title={projectWorkflowRunning ? "请先等待当前任务完成或取消任务" : undefined}
                type="button"
                onClick={replaceProjectSource}
              >
                {isReplacingSource ? "等待选择..." : "重新选择原视频"}
              </button>
            </div>
          </header>
          {sourceReplaceMessage && <p className="copy-status">{sourceReplaceMessage}</p>}
          <ProjectWorkflowOverview
            overview={workflowOverview}
            nextDisabled={Boolean(
              workflowOverview.nextAction &&
              overviewActionDisabledById[workflowOverview.nextAction.id],
            )}
            onRunNext={runOverviewNext}
            onStepSelect={scrollToWorkflowStep}
          />
        </>
  );
}

