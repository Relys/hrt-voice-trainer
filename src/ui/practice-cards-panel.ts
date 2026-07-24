import {
  addCustomCard,
  deleteCustomCard,
  listAllCards,
  PRACTICE_CARD_LEVEL_LABELS,
  PRACTICE_CARD_LEVELS,
  type PracticeCard,
  type PracticeCardLevel,
} from "../state/practice-cards.ts";

export interface PracticeCardsPanelCallbacks {
  onSelectCard: (card: PracticeCard) => void;
}

export class PracticeCardsPanel {
  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: PracticeCardsPanelCallbacks,
  ) {
    this.render();
  }

  private render(): void {
    const { container } = this;
    container.innerHTML = "";
    const cards = listAllCards();

    for (const level of PRACTICE_CARD_LEVELS) {
      const section = document.createElement("div");
      section.className = "settings-group";
      const heading = document.createElement("h3");
      heading.className = "settings-subhead";
      heading.textContent = PRACTICE_CARD_LEVEL_LABELS[level];
      section.appendChild(heading);

      const levelCards = cards.filter((c) => c.level === level);
      for (const card of levelCards) {
        section.appendChild(this.renderCardRow(card));
      }
      container.appendChild(section);
    }

    container.appendChild(this.renderAddCustomForm());
  }

  private renderCardRow(card: PracticeCard): HTMLElement {
    const row = document.createElement("div");
    row.className = "exercise-row";

    const text = document.createElement("p");
    text.className = "settings-note";
    text.textContent = card.text;
    row.appendChild(text);

    const actions = document.createElement("div");
    actions.className = "session-actions";

    const practiceBtn = document.createElement("button");
    practiceBtn.type = "button";
    practiceBtn.textContent = "Practice";
    practiceBtn.addEventListener("click", () => this.callbacks.onSelectCard(card));
    actions.appendChild(practiceBtn);

    if (card.custom) {
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", () => {
        deleteCustomCard(card.id);
        this.render();
      });
      actions.appendChild(deleteBtn);
    }
    row.appendChild(actions);
    return row;
  }

  private renderAddCustomForm(): HTMLElement {
    const section = document.createElement("div");
    section.className = "settings-group";
    const heading = document.createElement("h3");
    heading.className = "settings-subhead";
    heading.textContent = "Add a custom card";
    section.appendChild(heading);
    const note = document.createElement("p");
    note.className = "settings-note";
    note.textContent = "Private to you — write your own word, phrase, sentence, or short passage to practice with.";
    section.appendChild(note);

    const textInput = document.createElement("textarea");
    textInput.className = "custom-card-input";
    textInput.rows = 3;
    textInput.placeholder = "Type your practice text here…";
    section.appendChild(textInput);

    const row = document.createElement("div");
    row.className = "settings-row";
    const levelSelect = document.createElement("select");
    for (const level of PRACTICE_CARD_LEVELS) {
      const option = document.createElement("option");
      option.value = level;
      option.textContent = PRACTICE_CARD_LEVEL_LABELS[level];
      levelSelect.appendChild(option);
    }
    row.appendChild(levelSelect);

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.textContent = "Add card";
    addBtn.addEventListener("click", () => {
      const added = addCustomCard(textInput.value, levelSelect.value as PracticeCardLevel);
      if (added) this.render();
      else alert("Couldn't save that card — check the text isn't empty.");
    });
    row.appendChild(addBtn);
    section.appendChild(row);

    return section;
  }
}
