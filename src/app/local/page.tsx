import { getLocalRepoIdentity } from "~/server/generate/local";
import RepoPageClient from "~/app/[username]/[repo]/repo-page-client";

type LocalPageProps = {
  searchParams: Promise<{ path?: string }>;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LocalPage({ searchParams }: LocalPageProps) {
  const { path: localPath } = await searchParams;

  if (!localPath) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6 text-center">
        <p className="max-w-xl text-lg font-medium">
          Provide a local folder path with <code>/local?path=/absolute/path</code>.
        </p>
      </div>
    );
  }

  const identity = getLocalRepoIdentity(localPath);

  return (
    <RepoPageClient
      username={identity.username}
      repo={identity.repo}
      localPath={localPath}
      initialState={null}
    />
  );
}
