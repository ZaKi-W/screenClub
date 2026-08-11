// @vitest-environment jsdom
// ChatWelcome guards the "no provider connected" empty state: the copy reaches
// the DOM, the CTA fires, and a non-English locale is really translated rather
// than falling back to English. localeParity.test.ts covers key presence for
// the other locales; only the fallback check needs a rendered card.

import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/contexts/I18nContext";
import { LOCALE_STORAGE_KEY } from "@/i18n/config";
import { ChatWelcome } from "./ChatWelcome";

function renderIn(locale: string, ui: ReactElement) {
	localStorage.setItem(LOCALE_STORAGE_KEY, locale);
	return render(<I18nProvider>{ui}</I18nProvider>);
}

beforeEach(() => {
	localStorage.clear();
});

afterEach(() => {
	cleanup();
	localStorage.clear();
});

describe("ChatWelcome", () => {
	it("hides transcription features while the feature is disabled", () => {
		const onOpen = vi.fn();
		renderIn("en", <ChatWelcome onOpenProviderSettings={onOpen} />);

		expect(screen.getByRole("heading", { name: /bring your own ai/i })).toBeInTheDocument();
		expect(screen.getByText(/talk.*language model/i)).toBeInTheDocument();
		expect(screen.queryByText(/cut silences/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/add captions/i)).not.toBeInTheDocument();
		expect(screen.getByText(/rewrite a section/i)).toBeInTheDocument();
		expect(screen.queryByText(/transcript will be sent/i)).not.toBeInTheDocument();
	});

	it("invokes the onOpenProviderSettings callback when the CTA is clicked", () => {
		const onOpen = vi.fn();
		renderIn("en", <ChatWelcome onOpenProviderSettings={onOpen} />);

		fireEvent.click(screen.getByRole("button", { name: /set up a provider/i }));

		expect(onOpen).toHaveBeenCalledTimes(1);
	});

	it("renders the French welcome card with translated copy", () => {
		renderIn("fr", <ChatWelcome onOpenProviderSettings={vi.fn()} />);

		expect(screen.getByRole("heading", { name: /apportez votre ia/i })).toBeInTheDocument();
		expect(screen.getByText(/configurer un fournisseur/i)).toBeInTheDocument();
		expect(screen.queryByText(/transcript will be sent/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/transcription de votre vidéo/i)).not.toBeInTheDocument();
	});
});
