import type { PanelState } from '../../shared/ipc';
import { renderVote } from './vote';

const root = document.getElementById('root') as HTMLElement;

/** The roster is a stand-in until its rows are built: the room code and how full the room is. */
function renderRosterStub(state: PanelState): void {
  const header = document.createElement('header');
  header.className = 'roster-head';
  header.textContent = `${state.room.code ?? ''}  ${state.room.members.length} / ${state.max}`;
  root.replaceChildren(header);
}

window.panelApi.on((state) => {
  document.body.dataset.view = state.view;
  if (state.view === 'vote') renderVote(root, state, (action) => window.panelApi.act(action));
  else renderRosterStub(state);
});
