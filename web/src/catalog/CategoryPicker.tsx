import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/Button';
import { Input, Select } from '../components/Field';
import { api, ApiError } from '../api/client';
import { afterWrite } from '../api/cache';
import type { components } from '../api/schema';

type CategoryView = components['schemas']['CategoryView'];

/**
 * The product form's category box, with a way to add one without leaving it.
 *
 * Setting up a catalog means meeting a category that does not exist yet
 * halfway through typing in a product. Closing the form for *Categories &
 * tiers* throws away everything typed so far, so **+ New** adds it here and
 * picks it.
 *
 * Three details:
 *
 * - **No nested form.** This sits inside the product form, and a `<form>`
 *   cannot contain another, so Enter is caught on the box — left alone it
 *   would save the whole product with the category still missing.
 * - **A name already on the list is picked, not sent.** Typing "Beverages"
 *   when it exists would be a 409 for no reason; the person meant that one.
 * - **The returned id is the one used**, never the id minted here. Re-adding a
 *   name that was deleted revives the old row (§4), which has its own id.
 */
export function CategoryPicker({
  value,
  onChange,
  categories,
}: {
  value: string;
  onChange: (categoryId: string) => void;
  categories: CategoryView[];
}) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const done = (categoryId: string) => {
    onChange(categoryId);
    setAdding(false);
    setName('');
    setError(null);
  };

  const create = useMutation({
    mutationFn: (trimmed: string) =>
      api.post<CategoryView>('/categories', {
        id: crypto.randomUUID(),
        name: trimmed,
      }),
    onSuccess: (created) => {
      // In the list at once, so the box shows its name rather than "None"
      // while the list refetches.
      queryClient.setQueryData<CategoryView[]>(
        ['categories'],
        (current = []) =>
          current.some((row) => row.id === created.id)
            ? current
            : [...current, created].sort((a, b) =>
                a.name.localeCompare(b.name),
              ),
      );
      afterWrite(queryClient);
      done(created.id);
    },
    onError: (caught) =>
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Could not add that category.',
      ),
  });

  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = categories.find(
      (row) => row.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) done(existing.id);
    else create.mutate(trimmed);
  };

  if (!adding) {
    return (
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <Select
            id="p-category"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          >
            <option value="">None</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setAdding(true)}
          className="shrink-0"
        >
          + New
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <Input
            id="p-category"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
            placeholder="New category, e.g. Beverages"
            maxLength={120}
            autoFocus
          />
        </div>
        <Button
          type="button"
          onClick={add}
          disabled={create.isPending || !name.trim()}
          className="shrink-0"
        >
          {create.isPending ? 'Adding…' : 'Add'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setAdding(false);
            setName('');
            setError(null);
          }}
          disabled={create.isPending}
          className="shrink-0"
        >
          Cancel
        </Button>
      </div>
      {error && (
        <p className="mt-1 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
