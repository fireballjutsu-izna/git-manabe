/**
 * Git シミュレータの入口。
 *
 * UI 側はここからだけ import する。中身は全て純粋関数で、
 * react も next も DOM API も使わないので、そのまま Vitest で試せる。
 */

export type {
  Area,
  Commit,
  CommandResult,
  ConflictFile,
  Content,
  FileState,
  FileStatus,
  Head,
  Pausing,
  Ref,
  ReflogEntry,
  Remote,
  RepoState,
  StashEntry,
  Todo,
  TodoItem,
  Tree,
} from './types';

export {
  emptyState,
  headCommitId,
  currentBranchName,
  refsAt,
  resolveRevision,
  ancestorsOf,
  isAncestor,
  mergeBase,
  commitsBetween,
  pathsIn,
  reachableCommits,
  aheadBehind,
  findRemote,
  pausingWays,
  treeOf,
  headTree,
} from './state';
export { diffLines, formatFileDiff, hasConflictMarkers, sameContent } from './content';
export { isIgnored, ignorePatterns, matchesIgnore } from './ignore';
export { run } from './run';
export { parseLine, GIT_COMMANDS, HELPER_COMMANDS, PLANNED_COMMANDS } from './parse';
export {
  initHistory,
  pushHistory,
  undo,
  redo,
  canUndo,
  canRedo,
  resetHistory,
  type History,
} from './history';
export { layoutGraph, type GraphLayout, type GraphNode, type GraphEdge } from './layout';
