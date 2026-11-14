// Reads the request on stdin and answers on stdout. Saying nothing leaves the request to the person.
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const request = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
const command = request.permission?.command ?? "";

const refused = [/\bgit\s+push\b.*--force(?!-with-lease)/, /\brm\s+-[a-zA-Z]*r/];
if (refused.some((pattern) => pattern.test(command))) {
  console.log(JSON.stringify({ permissionDecision: "deny", reason: "The approval gate refuses force pushes and recursive deletes." }));
} else if (new RegExp(process.env.CAPSULE_USER_CONFIG_ALLOWED ?? "^$").test(command)) {
  console.log(JSON.stringify({ permissionDecision: "allow", reason: "A test or lint run." }));
}
