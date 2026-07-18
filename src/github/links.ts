import type { GithubRepository } from "./types";

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function githubFileUrl(repository: GithubRepository, path: string): string {
  const owner = encodeURIComponent(repository.owner);
  const name = encodeURIComponent(repository.name);
  const branch = encodeURIComponent(repository.defaultBranch);
  return `https://github.com/${owner}/${name}/blob/${branch}/${encodePath(path)}`;
}
