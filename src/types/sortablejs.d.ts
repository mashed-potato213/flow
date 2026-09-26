// sortablejs 的类型声明（项目未安装 @types/sortablejs）
declare module 'sortablejs' {
  interface SortableOptions {
    animation?: number;
    handle?: string;
    delay?: number;
    delayOnTouchOnly?: boolean;
    onEnd?: (event: SortableEvent) => void;
    onStart?: (event: SortableEvent) => void;
    onChange?: (event: SortableEvent) => void;
  }

  interface SortableEvent {
    oldIndex?: number;
    newIndex?: number;
    item: HTMLElement;
    from: HTMLElement;
    to: HTMLElement;
  }

  class Sortable {
    constructor(element: HTMLElement, options?: SortableOptions);
    static create(element: HTMLElement, options?: SortableOptions): Sortable;
    destroy(): void;
  }

  export default Sortable;
}
