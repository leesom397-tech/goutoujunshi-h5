import unittest
from PIL import Image, ImageDraw

from voice_frame_identity import capture_frame_identity, frame_identity_matches


class FrameIdentityTests(unittest.TestCase):
    def setUp(self):
        self.image = Image.new('RGB', (240, 320), '#202020')
        draw = ImageDraw.Draw(self.image)
        draw.rectangle((40, 40, 150, 54), fill='white')  # Unique OCR-verified anchor.
        draw.rectangle((125, 100, 210, 127), fill='#65bb45')
        draw.rectangle((125, 160, 210, 187), fill='#65bb45')  # Same-looking voice.
        self.bubble = {'x': 125, 'y': 160, 'width': 86, 'height': 28}
        self.options = dict(chat_region=(20, 20, 200, 280), bubble=self.bubble,
                            anchor={'localId': 'left', 'top': 40, 'bottom': 55},
                            source_id='voice-2', matched_anchors=['left', 'right'])
        self.identity = capture_frame_identity(self.image, **self.options)

    def matches(self, image, **kwargs):
        options = dict(source_id='voice-2', bubble=self.bubble)
        options.update(kwargs)
        return frame_identity_matches(self.identity, image, **options)

    def test_unchanged_verified_prefix_matches(self):
        self.assertIsNotNone(self.identity)
        self.assertTrue(self.matches(self.image))

    def test_body_and_following_anchor_can_expand_out_of_view(self):
        after = self.image.copy()
        ImageDraw.Draw(after).rectangle((30, 188, 219, 319), fill='#353535')
        self.assertTrue(self.matches(after))

    def test_change_to_preceding_anchor_invalidates_even_with_same_bubble(self):
        after = self.image.copy()
        after.putpixel((50, 45), (30, 30, 30))
        self.assertFalse(self.matches(after))

    def test_change_between_anchor_and_voice_invalidates(self):
        after = self.image.copy()
        after.putpixel((40, 80), (255, 255, 255))
        self.assertFalse(self.matches(after))

    def test_change_to_previous_identical_voice_invalidates(self):
        after = self.image.copy()
        after.putpixel((140, 110), (0, 0, 0))
        self.assertFalse(self.matches(after))

    def test_change_to_source_voice_invalidates(self):
        after = self.image.copy()
        after.putpixel((140, 170), (0, 0, 0))
        self.assertFalse(self.matches(after))

    def test_another_source_id_cannot_reuse_same_pixels(self):
        self.assertFalse(self.matches(self.image, source_id='voice-1'))

    def test_same_looking_bubble_at_different_position_does_not_match(self):
        self.assertFalse(self.matches(self.image, bubble={**self.bubble, 'y': 100}))

    def test_shifted_viewport_invalidates(self):
        after = Image.new('RGB', self.image.size, '#202020')
        after.paste(self.image, (0, -10))
        self.assertFalse(self.matches(after))

    def test_window_resize_invalidates(self):
        self.assertFalse(self.matches(self.image.resize((241, 320))))

    def test_snapshot_not_mutated_with_original_image(self):
        self.image.putpixel((50, 45), (0, 0, 0))
        self.assertFalse(self.matches(self.image))

    def test_missing_or_wrong_preceding_anchor_rejects_capture(self):
        for anchor in ({}, {'localId': 'wrong', 'top': 40, 'bottom': 55},
                       {'localId': 'left', 'top': 170, 'bottom': 180}):
            with self.subTest(anchor=anchor):
                self.assertIsNone(capture_frame_identity(self.image, **{**self.options, 'anchor': anchor}))

    def test_single_or_duplicate_anchor_ids_reject_capture(self):
        for anchors in (['left'], ['left', 'left'], ['left', 'voice-2']):
            self.assertIsNone(capture_frame_identity(self.image, **{**self.options, 'matched_anchors': anchors}))

    def test_clipped_or_invalid_geometry_rejects_capture(self):
        for bubble in ({**self.bubble, 'clipped': True}, {**self.bubble, 'y': 290},
                       {**self.bubble, 'x': -1}, {**self.bubble, 'width': float('nan')}):
            with self.subTest(bubble=bubble):
                self.assertIsNone(capture_frame_identity(self.image, **{**self.options, 'bubble': bubble}))

    def test_unbound_or_malformed_identity_cannot_match(self):
        self.assertFalse(frame_identity_matches(None, self.image, source_id='voice-2', bubble=self.bubble))
        self.assertFalse(self.matches(self.image, bubble={'x': 1}))

    def test_dictionary_chat_region_supported(self):
        identity = capture_frame_identity(self.image, **{**self.options, 'chat_region':
            {'x': 20, 'y': 20, 'width': 200, 'height': 280}})
        self.assertTrue(frame_identity_matches(identity, self.image, source_id='voice-2', bubble=self.bubble))

    def test_private_pixels_not_in_repr(self):
        self.assertNotIn('pixels=', repr(self.identity))


if __name__ == '__main__':
    unittest.main()
