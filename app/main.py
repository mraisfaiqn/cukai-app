
# Main part, starts the web server and defines the pages:
#
#   GET  /                  -> the login page
#   POST /userLogin         -> checks the username + password
#   GET  /profile/{id}      -> that user's profile (personal + company)

from fastapi import Depends, FastAPI, Form, Request
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import CompanyProfile, UserProfile

app = FastAPI(title="Cukai.ai - User Profiles")

# Tell the app where to find our HTML pages and our CSS file.
templates = Jinja2Templates(directory="templates")
app.mount("/static", StaticFiles(directory="static"), name="static")


# The login page (the first thing a visitor sees) 
@app.get("/")
def login_page(request: Request):
    return templates.TemplateResponse(request, "login.html", {"error": None})


# Handle the login form
# We use POST (not GET) because we are sending a password, and POST keeps it out
# of the web address. The form on login.html sends "username" and "password".
@app.post("/userLogin")
def user_login(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db),
):
    # Look for a user whose username matches what was typed.
    user = db.query(UserProfile).filter(UserProfile.username == username).first()

    # If there is no such user, OR the password does not match, show an error.
    if not user or user.password != password:
        return templates.TemplateResponse(
            request,
            "login.html",
            {"error": "Wrong username or password."},
        )

    # Success - send them to their profile page.
    return RedirectResponse(url=f"/profile/{user.id}", status_code=303)


# The profile page: shows BOTH the personal info and the company info
@app.get("/profile/{user_id}")
def profile_page(user_id: int, request: Request, db: Session = Depends(get_db)):
    user = db.query(UserProfile).filter(UserProfile.id == user_id).first()
    if not user:
        return templates.TemplateResponse(
            request,
            "login.html",
            {"error": "That profile was not found."},
        )

    # Find the company linked to this user.
    company = db.query(CompanyProfile).filter(CompanyProfile.id == user.company_id).first()

    return templates.TemplateResponse(
        request,
        "profile.html",
        {"user": user, "company": company},
    )