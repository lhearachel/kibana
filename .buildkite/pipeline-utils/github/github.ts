/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { Octokit } from '@octokit/rest';

export const KIBANA_COMMENT_SIGIL = 'kbn-message-context';

const github = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

export type ChangedFile = {
  filename: string;
  previous_filename?: string;
};

let prChangesCache: null | ChangedFile[] = null;
let commitChangesCache: null | ChangedFile[] = null;

export const getPrChanges = async (
  owner = process.env.GITHUB_PR_BASE_OWNER,
  repo = process.env.GITHUB_PR_BASE_REPO,
  prNumber: undefined | string | number = process.env.GITHUB_PR_NUMBER
): Promise<ChangedFile[]> => {
  if (!owner || !repo || !prNumber) {
    throw Error(
      "Couldn't retrieve Github PR info from environment variables in order to retrieve PR changes"
    );
  }

  const files = await github.paginate(github.pulls.listFiles, {
    owner,
    repo,
    pull_number: typeof prNumber === 'number' ? prNumber : parseInt(prNumber, 10),
    per_page: 100,
  });

  return files;
};

export const getPrChangesCached = async () => {
  prChangesCache = prChangesCache || (await getPrChanges());
  return prChangesCache;
};

export const getCommitChanges = async (
  owner = process.env.GITHUB_PR_BASE_OWNER,
  repo = process.env.GITHUB_PR_BASE_REPO,
  sha: undefined | string = process.env.GITHUB_PR_TRIGGERED_SHA
): Promise<ChangedFile[]> => {
  if (!owner || !repo || !sha) {
    throw Error(
      "Couldn't retrieve Github commit info from environment variables in order to retrieve commit changes"
    );
  }

  const { data } = await github.repos.getCommit({
    owner,
    repo,
    ref: sha,
    per_page: 100,
  });

  // Merge-commits are sometimes represented by a nil-set of changed files
  return data.files ?? [];
};

export const getCommitChangesCached = async () => {
  commitChangesCache = commitChangesCache || (await getCommitChanges());
  return commitChangesCache;
};

export const areChangesSkippable = async (
  skippablePaths: RegExp[],
  requiredPaths: RegExp[] = [],
  changes: null | ChangedFile[] = null
) => {
  const commitChanges = changes || (await getCommitChangesCached());

  if (commitChanges.length === 0 || commitChanges.length >= 3000) {
    return false;
  }

  if (requiredPaths?.length) {
    const someFilesMatchRequired = requiredPaths.some((path) =>
      commitChanges.some(
        (change) => change.filename.match(path) || change.previous_filename?.match(path)
      )
    );

    if (someFilesMatchRequired) {
      return false;
    }
  }

  const someFilesNotSkippable = commitChanges.some(
    (change) =>
      !skippablePaths.some(
        (path) =>
          change.filename.match(path) &&
          (!change.previous_filename || change.previous_filename.match(path))
      )
  );

  return !someFilesNotSkippable;
};

export const doAllChangesMatch = async (
  path: RegExp,
  changes: null | ChangedFile[] = null
) => {
  const prChanges = changes || (await getCommitChangesCached());

  if (prChanges.length >= 3000) {
    return false;
  }

  const allChangesMatch = prChanges.every(
    (change) =>
      change.filename.match(path) &&
      (!change.previous_filename || change.previous_filename.match(path))
  );

  return allChangesMatch;
};

export const doAnyChangesMatch = async (
  requiredPaths: RegExp[],
  changes: null | ChangedFile[] = null
) => {
  const commitChanges = changes || (await getCommitChangesCached());

  if (commitChanges.length === 0 || commitChanges.length >= 3000) {
    return true;
  }

  const anyFilesMatchRequired = requiredPaths.some((path) =>
    commitChanges.some((change) => change.filename.match(path) || change.previous_filename?.match(path))
  );

  return anyFilesMatchRequired;
};

export function addComment(
  comment: string,
  owner = process.env.GITHUB_PR_BASE_OWNER,
  repo = process.env.GITHUB_PR_BASE_REPO,
  prNumber: undefined | string | number = process.env.GITHUB_PR_NUMBER
) {
  if (!owner || !repo || !prNumber) {
    throw Error(
      "Couldn't retrieve Github PR info from environment variables in order to add a comment"
    );
  }

  return github.issues.createComment({
    owner,
    repo,
    issue_number: typeof prNumber === 'number' ? prNumber : parseInt(prNumber, 10),
    body: comment,
  });
}

export async function upsertComment(
  messageOpts: {
    commentBody: string;
    commentContext: string;
    clearPrevious: boolean;
  },
  owner = process.env.GITHUB_PR_BASE_OWNER,
  repo = process.env.GITHUB_PR_BASE_REPO,
  prNumber: undefined | string | number = process.env.GITHUB_PR_NUMBER
) {
  const { commentBody, commentContext, clearPrevious } = messageOpts;
  if (!owner || !repo || !prNumber) {
    throw Error(
      "Couldn't retrieve Github PR info from environment variables in order to add a comment"
    );
  }
  if (!commentContext) {
    throw Error('Comment context is required when updating a comment');
  }

  const commentMarker = `<!-- ${KIBANA_COMMENT_SIGIL}:${commentContext} -->`;
  const body = `${commentMarker}\n${commentBody}`;

  const existingComment = (
    await github.paginate(github.issues.listComments, {
      owner,
      repo,
      issue_number: typeof prNumber === 'number' ? prNumber : parseInt(prNumber, 10),
    })
  ).find((comment) => comment.body?.includes(commentMarker));

  if (!existingComment) {
    return addComment(body, owner, repo, prNumber);
  } else if (clearPrevious) {
    await github.issues.deleteComment({
      owner,
      repo,
      comment_id: existingComment.id,
    });
    return addComment(body, owner, repo, prNumber);
  } else {
    return github.issues.updateComment({
      owner,
      repo,
      comment_id: existingComment.id,
      body,
    });
  }
}

export function getGithubClient() {
  return github;
}
