import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createStore, shallowEqual } from './store';
import { useStore } from './hooks';

describe('useStore', () => {
  it('returns full state when no selector is provided', () => {
    const store = createStore({ count: 0, text: 'hello' });
    const { result } = renderHook(() => useStore(store));

    expect(result.current).toEqual({ count: 0, text: 'hello' });

    act(() => {
      store.set({ count: 1, text: 'world' });
    });

    expect(result.current).toEqual({ count: 1, text: 'world' });
  });

  it('selects slice and prevents re-renders when unselected state changes', () => {
    const store = createStore({ count: 0, text: 'hello' });
    let renderCount = 0;

    const { result } = renderHook(() => {
      renderCount++;
      return useStore(store, (s) => s.text);
    });

    expect(result.current).toBe('hello');
    expect(renderCount).toBe(1);

    // Update unselected slice (count)
    act(() => {
      store.set({ count: 1, text: 'hello' });
    });

    // Should NOT have triggered a re-render
    expect(result.current).toBe('hello');
    expect(renderCount).toBe(1);

    // Update selected slice (text)
    act(() => {
      store.set({ count: 1, text: 'world' });
    });

    // Should have triggered a re-render
    expect(result.current).toBe('world');
    expect(renderCount).toBe(2);
  });

  it('supports custom equality function like shallowEqual for object slices', () => {
    const store = createStore({ nested: { a: 1, b: 2 }, other: 100 });
    let renderCount = 0;

    const { result } = renderHook(() => {
      renderCount++;
      return useStore(store, (s) => ({ a: s.nested.a }), shallowEqual);
    });

    expect(result.current).toEqual({ a: 1 });
    expect(renderCount).toBe(1);

    // Update other state; selector returns new object with same contents
    act(() => {
      store.set({ nested: { a: 1, b: 3 }, other: 200 });
    });

    expect(result.current).toEqual({ a: 1 });
    expect(renderCount).toBe(1);

    // Update nested.a
    act(() => {
      store.set({ nested: { a: 99, b: 3 }, other: 200 });
    });

    expect(result.current).toEqual({ a: 99 });
    expect(renderCount).toBe(2);
  });
});
