import { describe, it, expect } from 'vitest';
import { StateMachine } from '../src/state';
import { AppState, StateTransition, InputFocus } from '../src/types';

describe('StateMachine', () => {
  it('starts in GAME_MINIMIZED state', () => {
    const sm = new StateMachine();
    expect(sm.state).toBe(AppState.GAME_MINIMIZED);
  });

  it('focus is CHILD when minimized', () => {
    const sm = new StateMachine();
    expect(sm.snapshot.inputFocus).toBe(InputFocus.CHILD);
  });

  it('TOGGLE from MINIMIZED → ACTIVE', () => {
    const sm = new StateMachine();
    sm.transition(StateTransition.TOGGLE);
    expect(sm.state).toBe(AppState.GAME_ACTIVE);
    expect(sm.snapshot.inputFocus).toBe(InputFocus.GAME);
    expect(sm.snapshot.gameVisible).toBe(true);
  });

  it('TOGGLE from ACTIVE → MINIMIZED', () => {
    const sm = new StateMachine();
    sm.transition(StateTransition.TOGGLE);
    sm.transition(StateTransition.TOGGLE);
    expect(sm.state).toBe(AppState.GAME_MINIMIZED);
    expect(sm.snapshot.inputFocus).toBe(InputFocus.CHILD);
    expect(sm.snapshot.gameVisible).toBe(false);
  });

  it('MANUAL_PAUSE from ACTIVE → PAUSED', () => {
    const sm = new StateMachine();
    sm.transition(StateTransition.TOGGLE); // → ACTIVE
    sm.transition(StateTransition.MANUAL_PAUSE);
    expect(sm.state).toBe(AppState.GAME_PAUSED);
  });

  it('RESUME from PAUSED → ACTIVE', () => {
    const sm = new StateMachine();
    sm.transition(StateTransition.TOGGLE); // → ACTIVE
    sm.transition(StateTransition.MANUAL_PAUSE); // → PAUSED
    sm.transition(StateTransition.RESUME);
    expect(sm.state).toBe(AppState.GAME_ACTIVE);
    expect(sm.snapshot.inputFocus).toBe(InputFocus.GAME);
  });

  it('TOGGLE from PAUSED → ACTIVE', () => {
    const sm = new StateMachine();
    sm.transition(StateTransition.TOGGLE); // → ACTIVE
    sm.transition(StateTransition.MANUAL_PAUSE); // → PAUSED
    sm.transition(StateTransition.TOGGLE);
    expect(sm.state).toBe(AppState.GAME_ACTIVE);
  });

  it('MINIMIZE from ACTIVE → MINIMIZED', () => {
    const sm = new StateMachine();
    sm.transition(StateTransition.TOGGLE); // → ACTIVE
    sm.transition(StateTransition.MINIMIZE);
    expect(sm.state).toBe(AppState.GAME_MINIMIZED);
  });

  it('MINIMIZE from PAUSED → MINIMIZED', () => {
    const sm = new StateMachine();
    sm.transition(StateTransition.TOGGLE); // → ACTIVE
    sm.transition(StateTransition.MANUAL_PAUSE); // → PAUSED
    sm.transition(StateTransition.MINIMIZE);
    expect(sm.state).toBe(AppState.GAME_MINIMIZED);
  });

  it('CHILD_EXIT from any state → EXITING', () => {
    const sm = new StateMachine();
    sm.transition(StateTransition.CHILD_EXIT);
    expect(sm.state).toBe(AppState.EXITING);
  });

  it('CHILD_EXIT from ACTIVE → EXITING', () => {
    const sm = new StateMachine();
    sm.transition(StateTransition.TOGGLE); // → ACTIVE
    sm.transition(StateTransition.CHILD_EXIT);
    expect(sm.state).toBe(AppState.EXITING);
  });

  it('no-op transitions do not change state', () => {
    const sm = new StateMachine();
    sm.transition(StateTransition.MANUAL_PAUSE); // invalid from MINIMIZED
    expect(sm.state).toBe(AppState.GAME_MINIMIZED);
  });

  it('EXITING state is terminal — no transitions out', () => {
    const sm = new StateMachine();
    sm.transition(StateTransition.CHILD_EXIT); // → EXITING
    sm.transition(StateTransition.TOGGLE); // should be no-op
    expect(sm.state).toBe(AppState.EXITING);
  });

  it('emits transition events', () => {
    const sm = new StateMachine();
    const events: any[] = [];
    sm.on('transition', (e: any) => events.push(e));
    sm.transition(StateTransition.TOGGLE);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      from: AppState.GAME_MINIMIZED,
      to: AppState.GAME_ACTIVE,
      trigger: StateTransition.TOGGLE,
    });
  });
});
