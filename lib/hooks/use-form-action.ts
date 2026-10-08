"use client";

import {
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useRef,
  type FormEvent,
} from "react";

type State = { ok?: boolean };

/**
 * Server-action form that KEEPS what the user typed when the server answers with an error.
 *
 * React 19 resets a form after a function `action` completes, which wiped every field (including the email on a wrong
 * password, or a whole lead form on one invalid field). Submitting through onSubmit instead keeps the inputs as they
 * are; on success (`state.ok`) the form is cleared, as before.
 */
export function useFormAction<S extends State>(
  action: (prev: S, formData: FormData) => Promise<S>,
  initial: S,
) {
  const [state, dispatch, pending] = useActionState(
    action as unknown as (prev: State, formData: FormData) => Promise<State>,
    initial as State,
  );
  const ref = useRef<HTMLFormElement>(null);

  const onSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const data = new FormData(e.currentTarget);
      startTransition(() => dispatch(data));
    },
    [dispatch],
  );

  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);

  return { state: state as S, pending, formProps: { ref, onSubmit } };
}
