// The seam between the game and wherever the game is actually running.
//
// A transport gives the interface below. The screen talks only to this, so it
// cannot tell whether the opponents are bots in this tab or four strangers on
// a server in Frankfurt.
//
//   createX(config, handlers) -> {
//     start()            begin the game
//     send(action)       play an action as the local player
//     close()            leave the table
//     me                 the local player's id
//   }
//
// handlers:
//   onEvent(event)   one thing that happened, already redacted for this player.
//                    May return a promise; a local table waits for it, so the
//                    animation never falls behind the game.
//   onView(view)     the full picture after a batch of events settled
//   onError(error)   a rejected action or a dropped connection
//   onStatus(text)   human-readable connection state, for the online version
//
// Events and actions are plain JSON in both directions, so the same messages
// go over a websocket unchanged.

export const ACTION_TYPES = ['start', 'draw', 'discard', 'choose', 'next'];

export function isTerminalEvent (event) {
  return event.t === 'gameEnd';
}
