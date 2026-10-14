// Socket lifecycle only. The work owns admission, identity and recovery.
function attachPlayers(namespace, {
  events,
  policy,
  makeJoined = ({ token, identity, recovered = false, restore = null }) => ({ token, identity, recovered, restore }),
  makeRejected = (reason) => ({ reason }),
  readToken = (payload) => payload && payload.token,
  onError = () => {},
}) {
  for (const key of ["join", "joined", "rejected"]) {
    if (!events || typeof events[key] !== "string" || !events[key]) {
      throw new Error(`players needs events.${key}`);
    }
  }
  if (!policy || typeof policy.join !== "function" || typeof policy.release !== "function") {
    throw new Error("players needs work policy.join and policy.release");
  }
  const sessions = new Set();
  let stopped = false;
  let closing;

  function report(error) { onError(error); }
  function broadcast() {
    if (!stopped && events.state && policy.snapshot) {
      namespace.emit(events.state, policy.snapshot());
    }
  }
  function context(session) {
    return { ...session.assignment, socketId: session.socket.id };
  }
  async function release(session) {
    if (session.assignment) {
      const current = context(session);
      session.assignment = null;
      await policy.release(current);
      broadcast();
    }
  }
  function enqueue(session, operation) {
    session.queue = session.queue.then(operation).catch(report);
    return session.queue;
  }
  function detach(session) {
    session.active = false;
    for (const [event, handler] of session.handlers) session.socket.off(event, handler);
    session.handlers.length = 0;
  }
  function connection(socket) {
    const session = { socket, assignment: null, active: true, queue: Promise.resolve(), handlers: [] };
    sessions.add(session);
    function listen(event, handler) {
      socket.on(event, handler);
      session.handlers.push([event, handler]);
    }
    listen(events.join, (payload) => enqueue(session, async () => {
      if (!session.active || stopped) return;
      if (session.assignment) {
        socket.emit(events.joined, makeJoined(session.assignment));
        return;
      }
      try {
        const assignment = await policy.join({ socketId: socket.id, token: readToken(payload) || null, payload });
        if (!assignment || assignment.status === "rejected") {
          if (session.active && !stopped) socket.emit(events.rejected, makeRejected((assignment && assignment.reason) || "Rejected"));
          return;
        }
        session.assignment = assignment;
        if (typeof assignment.token !== "string" || !assignment.token || assignment.identity === undefined) {
          throw new Error("policy.join must return token and identity, or status: rejected");
        }
        if (!session.active || stopped) {
          await release(session);
          return;
        }
        socket.emit(events.joined, makeJoined(assignment));
        broadcast();
      } catch (error) {
        await release(session);
        if (session.active && !stopped) socket.emit(events.rejected, makeRejected("Join failed"));
        report(error);
      }
    }));
    for (const kind of ["control", "action"]) {
      if (!events[kind] || !policy[kind]) continue;
      listen(events[kind], (payload) => enqueue(session, async () => {
        if (!session.active || stopped || !session.assignment) return;
        await policy[kind](context(session), payload);
        broadcast();
      }));
    }
    listen("disconnect", () => {
      detach(session);
      enqueue(session, () => release(session)).finally(() => sessions.delete(session));
    });
    if (events.state && policy.snapshot) socket.emit(events.state, policy.snapshot());
  }
  namespace.on("connection", connection);
  return {
    broadcast,
    close() {
      if (closing) return closing;
      stopped = true;
      namespace.off("connection", connection);
      closing = Promise.all([...sessions].map((session) => {
        detach(session);
        session.socket.disconnect(false);
        return enqueue(session, () => release(session));
      })).then(() => { sessions.clear(); });
      return closing;
    },
  };
}

module.exports = { attachPlayers };
