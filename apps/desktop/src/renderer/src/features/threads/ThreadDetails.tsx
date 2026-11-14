import { useWorkspace } from "../../lib/workspace";
import { useThreadActions } from "./ThreadActions";
import { TagEditor } from "./TagEditor";

/** The thread's tags in Conversation details; read-only chips on a paired device. */
export function ThreadDetailsRows() {
  const { session } = useWorkspace();
  const actions = useThreadActions();
  if (!session) return null;
  return (
    <section className="session-details-tags" aria-label="Tags">
      <h4>Tags</h4>
      <TagEditor tags={session.tags ?? []} suggestions={actions.allTags} disabled={!actions.writable}
        onChange={(next) => void actions.setTags(session.id, next)} />
    </section>
  );
}
