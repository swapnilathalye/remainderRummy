// A table that lives on a server, reached over a websocket.
//
// This is the online half of the game. It is written and ready; what it needs
// is the server in /server actually deployed somewhere, and a lobby screen to
// choose a room. The message format is the one the server already speaks.
//
//   up    {t:'hello', room, name, seat?}        join or create a room
//         {t:'action', action}                  play
//         {t:'ping'}
//   down  {t:'welcome', you, room, players}
//         {t:'events', events}                  already redacted for you
//         {t:'view', view}
//         {t:'error', message}
//         {t:'pong'}
//
// Two things differ from the local table and both are deliberate. The server
// will not wait for your animations, so incoming events are queued and played
// out in order at your own speed. And a dropped connection is normal, so it
// reconnects and asks for a fresh view rather than trying to replay what it
// missed.

const RECONNECT_DELAYS = [500, 1000, 2000, 4000, 8000];

export function createRemoteTable (config, handlers) {
  const url = config.url;
  let socket = null;
  let closed = false;
  let attempt = 0;
  let me = config.playerId || null;
  const queue = [];
  let draining = false;

  function status (text) {
    if (handlers.onStatus) handlers.onStatus(text);
  }

  // Events arrive as fast as the server sends them; play them one at a time so
  // the table animates in order.
  async function drain () {
    if (draining) return;
    draining = true;
    while (queue.length && !closed) {
      const event = queue.shift();
      try {
        await handlers.onEvent(event);
      } catch (err) {
        handlers.onError(err);
      }
    }
    draining = false;
  }

  function connect () {
    if (closed) return;
    // A page served over https may not open a plain ws:// socket, and iOS
    // refuses it outright in a released app. Say so rather than failing mutely.
    if (location.protocol === 'https:' && /^ws:\/\//i.test(url)) {
      handlers.onError(new Error(
        'This page is on https, so the server address has to start with wss:// not ws://'));
      return;
    }
    status(attempt ? 'Reconnecting…' : 'Connecting…');
    socket = new WebSocket(url);

    socket.addEventListener('open', () => {
      attempt = 0;
      status('Connected');
      send({ t: 'hello', room: config.room, name: config.name, playerId: me });
    });

    socket.addEventListener('message', ev => {
      let message;
      try { message = JSON.parse(ev.data); } catch (err) { return; }
      switch (message.t) {
        case 'welcome':
          me = message.you;
          status('At the table');
          if (handlers.onLobby) handlers.onLobby(message.players || [], false, message.room);
          break;
        case 'lobby':
          if (handlers.onLobby) handlers.onLobby(message.players || [], !!message.started, message.room);
          break;
        case 'events':
          queue.push(...message.events);
          drain();
          break;
        case 'view':
          handlers.onView(message.view);
          break;
        case 'error':
          handlers.onError(new Error(message.message));
          break;
      }
    });

    socket.addEventListener('close', () => {
      if (closed) return;
      status('Connection lost');
      const wait = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];
      attempt += 1;
      setTimeout(connect, wait);
    });

    socket.addEventListener('error', () => { /* close follows */ });
  }

  function send (message) {
    if (socket && socket.readyState === 1) socket.send(JSON.stringify(message));
  }

  return {
    get me () { return me; },
    start () { connect(); },
    // Deal the table. Whoever presses first starts it; the server ignores the
    // rest. A fuller lobby would make one player the host instead.
    startTable (options) { send({ t: 'start', options }); },
    send (action) { send({ t: 'action', action }); },
    close () {
      closed = true;
      if (socket) socket.close();
    }
  };
}
