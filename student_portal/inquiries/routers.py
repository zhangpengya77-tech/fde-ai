"""課程諮詢資料庫路由：inquiries 這個 app 的資料表只放在 DATABASES['inquiries']，
其他所有資料表（學員、教師、紀錄…）仍在 default，兩邊互不寫入。"""

APP = "inquiries"
DB = "inquiries"


class InquiryRouter:
    def db_for_read(self, model, **hints):
        return DB if model._meta.app_label == APP else None

    def db_for_write(self, model, **hints):
        return DB if model._meta.app_label == APP else None

    def allow_relation(self, obj1, obj2, **hints):
        labels = {obj1._meta.app_label, obj2._meta.app_label}
        if APP in labels:
            return labels == {APP}
        return None

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        if app_label == APP:
            return db == DB
        if db == DB:
            return False
        return None
