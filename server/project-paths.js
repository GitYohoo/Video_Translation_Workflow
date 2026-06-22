import path from "node:path";

function outputRootDirectory(record) {
  return path.dirname(record.sourcePath);
}

function fileArtifact(key, label, filePath) {
  if (!filePath) {
    return null;
  }
  return {
    key,
    label,
    kind: "file",
    path: filePath,
    displayName: path.basename(filePath),
  };
}

function directoryArtifact(key, label, directoryPath) {
  if (!directoryPath) {
    return null;
  }
  return {
    key,
    label,
    kind: "directory",
    path: directoryPath,
    displayName: path.basename(directoryPath),
  };
}

export function createProjectPathResolver({ uploadDirectory }) {
  function sourceFilePath(record) {
    return record.sourcePath || path.join(uploadDirectory, record.fileName);
  }

  function bsRoformerOutputPaths(record) {
    if (!record.sourcePath) {
      return null;
    }
    const videoStem = path.parse(record.sourcePath).name;
    const outputDirectory = path.join(outputRootDirectory(record), "BS-RoFormer_二轨分离");
    const audioDirectory = path.join(outputDirectory, "输出音轨");
    return {
      outputDirectory,
      dialoguePath: path.join(audioDirectory, `${videoStem}_DX_对白轨.wav`),
      backgroundPath: path.join(audioDirectory, `${videoStem}_MX+FX_无对白背景底轨.wav`),
    };
  }

  function ocrOutputPaths(record) {
    if (!record.sourcePath) {
      return null;
    }
    const videoStem = path.parse(record.sourcePath).name;
    const outputDirectory = path.join(outputRootDirectory(record), "OCR_字幕校准");
    return {
      outputDirectory,
      dataPath: path.join(outputDirectory, `${videoStem}_OCR_字幕数据.json`),
      srtPath: path.join(outputDirectory, `${videoStem}_OCR_标点修复.srt`),
      reportPath: path.join(outputDirectory, `${videoStem}_OCR_质量报告.html`),
    };
  }

  function whisperxOutputPaths(record) {
    const separationPaths = bsRoformerOutputPaths(record);
    if (!separationPaths) {
      return null;
    }
    const dialogueStem = path.parse(separationPaths.dialoguePath).name;
    const outputDirectory = path.join(separationPaths.outputDirectory, "WhisperX_说话人字幕");
    const baseName = `${dialogueStem}_Speaker_Diarization`;
    return {
      inputPath: separationPaths.dialoguePath,
      outputDirectory,
      srtPath: path.join(outputDirectory, `${baseName}.srt`),
      jsonPath: path.join(outputDirectory, `${baseName}.json`),
    };
  }

  function finalSubtitlesOutputPaths(record) {
    const ocrPaths = ocrOutputPaths(record);
    const speakerPaths = whisperxOutputPaths(record);
    if (!ocrPaths || !speakerPaths) {
      return null;
    }
    const videoStem = path.parse(record.sourcePath).name;
    const outputRoot = outputRootDirectory(record);
    const outputDirectory = path.join(outputRoot, "最终中文字幕");
    const translationOutputDirectory = path.join(
      outputRoot,
      `${videoStem}_英文翻译字幕`,
    );
    return {
      inputs: {
        speakerSrt: speakerPaths.srtPath,
        ocrSrt: ocrPaths.srtPath,
      },
      outputDirectory,
      srtPath: path.join(outputDirectory, `${videoStem}_最终中文字幕.srt`),
      translationTarget: {
        outputDirectory: translationOutputDirectory,
        jsonPath: path.join(translationOutputDirectory, `${videoStem}_Gemini翻译与整句分段.json`),
        srtPath: path.join(translationOutputDirectory, `${videoStem}_最终英文字幕.srt`),
        editorDraftPath: path.join(translationOutputDirectory, `${videoStem}_字幕编辑草稿.json`),
      },
      controlledTarget: {
        srtPath: path.join(translationOutputDirectory, `${videoStem}_受控英文字幕.srt`),
        reportPath: path.join(translationOutputDirectory, `${videoStem}_英文字幕预检报告.json`),
      },
      videoStem,
    };
  }

  function englishDubbingOutputPaths(record) {
    const finalPaths = finalSubtitlesOutputPaths(record);
    const separationPaths = bsRoformerOutputPaths(record);
    if (!finalPaths || !separationPaths) {
      return null;
    }
    const videoStem = path.parse(record.sourcePath).name;
    const workDirectory = path.join(finalPaths.translationTarget.outputDirectory, "英文配音分段");
    const dubbingGroupsDirectory = path.join(finalPaths.translationTarget.outputDirectory, "英文配音整句分段");
    const dubbingDirectory = path.join(workDirectory, "VoxCPM_英文配音");
    const assemblyDirectory = path.join(dubbingDirectory, "整轨合成");
    return {
      inputs: {
        chineseTimelineSrt: finalPaths.srtPath,
        englishDraftSrt: finalPaths.translationTarget.srtPath,
        geminiTranslationJson: finalPaths.translationTarget.jsonPath,
        englishSrt: finalPaths.controlledTarget.srtPath,
        dialogue: separationPaths.dialoguePath,
        background: separationPaths.backgroundPath,
      },
      dubbingGroupsDirectory,
      dubbingGroupsCsvPath: path.join(dubbingGroupsDirectory, "英文配音整句分段清单.csv"),
      dubbingGroupsJsonPath: path.join(dubbingGroupsDirectory, "英文配音整句分段清单.json"),
      dubbingGroupsReportPath: path.join(dubbingGroupsDirectory, "英文配音整句分段规划.html"),
      dubbingGroupsDisplaySrtPath: path.join(dubbingGroupsDirectory, "英文显示字幕.srt"),
      workDirectory,
      segmentManifestPath: path.join(workDirectory, "英文配音分段清单.csv"),
      dubbingDirectory,
      dubbingManifestPath: path.join(dubbingDirectory, "VoxCPM_英文配音清单.csv"),
      dubbingReportPath: path.join(dubbingDirectory, "VoxCPM_英文配音结果.html"),
      assemblyDirectory,
      dialogueTrackPath: path.join(assemblyDirectory, `${videoStem}_英文对白整轨.wav`),
      mixedTrackPath: path.join(assemblyDirectory, `${videoStem}_英文成片混音_MX+FX.wav`),
      assemblyReportPath: path.join(assemblyDirectory, "英文整轨合成结果.html"),
      progressLogPath: path.join(dubbingDirectory, "日志", "VoxCPM_运行.log"),
      preflightReportPath: finalPaths.controlledTarget.reportPath,
      videoStem,
    };
  }

  function finalVideoOutputPaths(record) {
    const dubbingPaths = englishDubbingOutputPaths(record);
    if (!dubbingPaths) {
      return null;
    }
    const videoStem = path.parse(record.sourcePath).name;
    const outputDirectory = outputRootDirectory(record);
    const prefix = `${videoStem}_英文配音`;
    return {
      inputs: {
        video: record.sourcePath,
        audio: dubbingPaths.mixedTrackPath,
        subtitle: dubbingPaths.inputs.englishSrt,
      },
      outputDirectory,
      styledAssPath: path.join(outputDirectory, `${prefix}_英文上方字幕.ass`),
      videoPath: path.join(outputDirectory, `${prefix}_内嵌英文字幕.mp4`),
      reportPath: path.join(outputDirectory, "英文配音视频成片结果.html"),
      previewPaths: [
        path.join(outputDirectory, "字幕样式参考帧", "字幕编辑参考帧.jpg"),
      ],
      prefix,
    };
  }

  function projectArtifacts(record) {
    if (!record.sourcePath) {
      return {};
    }
    const separation = bsRoformerOutputPaths(record);
    const ocr = ocrOutputPaths(record);
    const speakers = whisperxOutputPaths(record);
    const finalSubtitles = finalSubtitlesOutputPaths(record);
    const dubbing = englishDubbingOutputPaths(record);
    const finalVideo = finalVideoOutputPaths(record);
    const artifacts = {};
    const add = (artifact) => {
      if (artifact?.path) {
        artifacts[artifact.key] = artifact;
      }
    };

    add(fileArtifact("source.video", "原视频", record.sourcePath));
    add(directoryArtifact("bsRoformer.outputDirectory", "BS-RoFormer 输出目录", separation?.outputDirectory));
    add(fileArtifact("bsRoformer.dialogue", "DX 对白轨", separation?.dialoguePath));
    add(fileArtifact("bsRoformer.background", "MX+FX 背景底轨", separation?.backgroundPath));
    add(directoryArtifact("ocr.outputDirectory", "OCR 输出目录", ocr?.outputDirectory));
    add(fileArtifact("ocr.data", "OCR 字幕数据", ocr?.dataPath));
    add(fileArtifact("ocr.srt", "OCR 字幕 SRT", ocr?.srtPath));
    add(fileArtifact("ocr.report", "OCR 质量报告", ocr?.reportPath));
    add(fileArtifact("whisperx.input", "WhisperX 输入对白轨", speakers?.inputPath));
    add(directoryArtifact("whisperx.outputDirectory", "WhisperX 输出目录", speakers?.outputDirectory));
    add(fileArtifact("whisperx.srt", "Speaker_Diarization SRT", speakers?.srtPath));
    add(fileArtifact("whisperx.json", "Speaker_Diarization JSON", speakers?.jsonPath));
    add(directoryArtifact("finalSubtitles.outputDirectory", "最终中文字幕目录", finalSubtitles?.outputDirectory));
    add(fileArtifact("finalSubtitles.srt", "最终中文字幕 SRT", finalSubtitles?.srtPath));
    add(directoryArtifact("translation.outputDirectory", "英文翻译字幕目录", finalSubtitles?.translationTarget?.outputDirectory));
    add(fileArtifact("translation.geminiJson", "Gemini 翻译 JSON", finalSubtitles?.translationTarget?.jsonPath));
    add(fileArtifact("translation.englishDraftSrt", "英文字幕译稿", finalSubtitles?.translationTarget?.srtPath));
    add(fileArtifact("translation.editorDraft", "字幕编辑草稿", finalSubtitles?.translationTarget?.editorDraftPath));
    add(fileArtifact("translation.controlledEnglishSrt", "受控英文字幕 SRT", finalSubtitles?.controlledTarget?.srtPath));
    add(fileArtifact("translation.preflightReport", "英文字幕预检报告", finalSubtitles?.controlledTarget?.reportPath));
    add(directoryArtifact("englishDubbing.dubbingGroupsDirectory", "英文配音整句分段目录", dubbing?.dubbingGroupsDirectory));
    add(fileArtifact("englishDubbing.dubbingGroupsCsv", "英文配音整句分段清单", dubbing?.dubbingGroupsCsvPath));
    add(fileArtifact("englishDubbing.dubbingGroupsJson", "英文配音整句分段 JSON", dubbing?.dubbingGroupsJsonPath));
    add(fileArtifact("englishDubbing.dubbingGroupsReport", "英文配音整句分段报告", dubbing?.dubbingGroupsReportPath));
    add(fileArtifact("englishDubbing.dubbingGroupsDisplaySrt", "英文显示字幕 SRT", dubbing?.dubbingGroupsDisplaySrtPath));
    add(directoryArtifact("englishDubbing.workDirectory", "英文配音工作目录", dubbing?.workDirectory));
    add(fileArtifact("englishDubbing.segmentManifest", "英文配音分段清单", dubbing?.segmentManifestPath));
    add(directoryArtifact("englishDubbing.dubbingDirectory", "VoxCPM 英文配音目录", dubbing?.dubbingDirectory));
    add(fileArtifact("englishDubbing.dubbingManifest", "VoxCPM 英文配音清单", dubbing?.dubbingManifestPath));
    add(fileArtifact("englishDubbing.dubbingReport", "VoxCPM 试听报告", dubbing?.dubbingReportPath));
    add(directoryArtifact("englishDubbing.assemblyDirectory", "英文整轨合成目录", dubbing?.assemblyDirectory));
    add(fileArtifact("englishDubbing.dialogueTrack", "英文对白整轨", dubbing?.dialogueTrackPath));
    add(fileArtifact("englishDubbing.mixedTrack", "英文成片混音 MX+FX", dubbing?.mixedTrackPath));
    add(fileArtifact("englishDubbing.assemblyReport", "英文整轨合成结果", dubbing?.assemblyReportPath));
    add(fileArtifact("englishDubbing.progressLog", "VoxCPM 运行日志", dubbing?.progressLogPath));
    add(directoryArtifact("finalVideo.outputDirectory", "最终成片输出目录", finalVideo?.outputDirectory));
    add(fileArtifact("finalVideo.styledAss", "成片字幕 ASS", finalVideo?.styledAssPath));
    add(fileArtifact("finalVideo.video", "最终英文成片 MP4", finalVideo?.videoPath));
    add(fileArtifact("finalVideo.report", "成片结果报告", finalVideo?.reportPath));
    finalVideo?.previewPaths?.forEach((previewPath, index) => {
      add(fileArtifact(`finalVideo.preview.${index + 1}`, `字幕样式参考帧 ${index + 1}`, previewPath));
    });
    return artifacts;
  }

  function artifactForKey(record, key) {
    const artifact = projectArtifacts(record)[key];
    if (!artifact) {
      throw new Error(`未知项目产物：${key}`);
    }
    return artifact;
  }

  function artifactPathForKey(record, key) {
    return artifactForKey(record, key).path;
  }

  function knownProjectPaths(record) {
    return new Set(
      Object.values(projectArtifacts(record)).map((artifact) =>
        path.resolve(artifact.path).toLocaleLowerCase(),
      ),
    );
  }

  return {
    sourceFilePath,
    bsRoformerOutputPaths,
    ocrOutputPaths,
    whisperxOutputPaths,
    finalSubtitlesOutputPaths,
    englishDubbingOutputPaths,
    finalVideoOutputPaths,
    projectArtifacts,
    artifactForKey,
    artifactPathForKey,
    knownProjectPaths,
  };
}
