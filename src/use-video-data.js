import { useCallback } from "react";
import useSWR from "swr";
import { requestJson } from "./api.js";

const RUNNING_REFRESH_INTERVAL = 1500;
const IDLE_REFRESH_INTERVAL = 4000;

export function workflowStatusKey(videoId, workflow, revision = "") {
  if (!videoId) {
    return null;
  }
  const url = `/api/videos/${videoId}/workflow/${workflow}`;
  return revision ? `${url}?revision=${encodeURIComponent(revision)}` : url;
}

export function useVideoList() {
  const result = useSWR("/api/videos", requestJson);
  return {
    ...result,
    videos: result.data || [],
    errorMessage: result.error?.message || "",
  };
}

export function useVideoRecord(videoId, videos, isVideoListLoading) {
  const cachedVideo = videos.find((video) => video.id === videoId);
  const requestKey = videoId ? `/api/videos/${videoId}` : null;
  const { data, error, isLoading, mutate } = useSWR(requestKey, requestJson, {
    fallbackData: cachedVideo,
    revalidateOnMount: !cachedVideo,
  });

  return {
    record: data || cachedVideo || null,
    notFound: error?.status === 404,
    error,
    isLoading: Boolean(!cachedVideo && (isVideoListLoading || isLoading)),
    mutate,
  };
}

export function useWorkflowStatus(
  videoId,
  workflow,
  {
    refreshWhenIdle = true,
    revalidateOnFocus = true,
    revalidateOnMount,
    revision = "",
  } = {},
) {
  const requestKey = workflowStatusKey(videoId, workflow, revision);
  const result = useSWR(requestKey, requestJson, {
    revalidateOnFocus,
    revalidateOnMount,
    refreshInterval: (status) => {
      if (status?.status === "running") {
        return RUNNING_REFRESH_INTERVAL;
      }
      return refreshWhenIdle ? IDLE_REFRESH_INTERVAL : 0;
    },
  });
  const setStatus = useCallback(
    (value) => result.mutate(value, { revalidate: false }),
    [result.mutate],
  );

  return {
    ...result,
    status: result.data || null,
    errorMessage: result.error?.message || "",
    setStatus,
  };
}
