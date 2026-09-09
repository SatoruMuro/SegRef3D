"""Ownership boundaries for transient PyQt6 graphics items."""

from PyQt6 import sip
from PyQt6.QtCore import pyqtSignal
from PyQt6.QtWidgets import QGraphicsScene


def release_item(owner, name):
    """Forget first, then detach and destroy an exclusively held temporary item.

    Scene ownership ends at removeItem(). Explicit deletion avoids depending on
    wrapper GC. The validity check is confined to this teardown boundary.
    """
    item = getattr(owner, name, None)
    setattr(owner, name, None)
    if item is not None and not sip.isdeleted(item):
        scene = item.scene()
        if scene is not None:
            scene.removeItem(item)
        sip.delete(item)


class EditorGraphicsScene(QGraphicsScene):
    # Direct GUI-thread connections reset Python state before C++ deletes items.
    about_to_clear = pyqtSignal()

    def clear(self):
        self.about_to_clear.emit()
        super().clear()
